"""Context-aware assistant.

Unlike /chat (which exists to build the learner profile), this endpoint is a
general helper that ALWAYS loads the learner's live state first — profile,
current path with per-step status, everything completed, skill gaps, streak —
before answering anything. It can also request an action the frontend then
performs (currently: regenerating the path).
"""
import json
import re
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from openai import OpenAI

from app.config import OPENAI_API_KEY, OPENAI_MODEL
from app.models import AssistantRequest, AssistantResponse
from app.engine.catalog import load_catalog
from app.supabase_client import get_supabase

router = APIRouter(prefix="/assistant", tags=["assistant"])

SYSTEM_PROMPT = """You are the learner's study assistant inside a learning-path app.

You are given their FULL live state (profile, goal, current path with each
step's status, what they've completed, skill gaps). Always answer from that
state — never guess about their progress.

You have TWO jobs:
1. Answer their questions about their path and progress.
2. ONBOARD them if their profile is incomplete. If they have no goal yet,
   warmly ask what they're trying to learn or what role they're aiming for,
   plus their current skill level and anything they already know. Extract
   whatever they tell you into "profile".

STYLE — this is important:
- Be SHORT. 2-3 sentences maximum. No long paragraphs.
- No bullet-point essays, no headers, no numbered lists unless they ask for a list.
- Talk like a person, not a document. Direct and concrete.

You can request ONE action when it genuinely helps:
- "regenerate_path": rebuild their learning path. Use when they ask for a new
  or different path, when their goal changes, or when they've just told you
  their goal for the first time and have no path yet.

Respond with a JSON object:
  "reply": your short answer to show them
  "action": "regenerate_path" or null
  "profile": an object with any of "goal", "interests" (list), "skill_level"
             ("Beginner"/"Intermediate"/"Advanced"), "known_topics" (list)
             that you learned from THIS message. Omit keys you didn't learn.
             Never invent values. Omit the whole key if nothing new.

Return ONLY that JSON object."""


def _load_state(supabase, user_id: str) -> dict:
    profile_rows = (
        supabase.table("learner_profiles").select("*").eq("user_id", user_id).execute().data
    )
    profile = profile_rows[0] if profile_rows else {}

    all_items = (
        supabase.table("path_items").select("*").eq("user_id", user_id).order("order").execute().data
    )
    completed = sorted({r["title"] for r in all_items if r["status"] == "completed"})

    latest = (
        supabase.table("learning_paths")
        .select("path_id, skill_gaps")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    current_path_id = latest[0]["path_id"] if latest else None
    skill_gaps = latest[0].get("skill_gaps", []) if latest else []
    current = [r for r in all_items if r["path_id"] == current_path_id]

    return {
        "profile": profile,
        "completed_all_time": completed,
        "skill_gaps": skill_gaps,
        "current_path": [
            {
                "order": r["order"],
                "title": r["title"],
                "type": r.get("item_type", "course"),
                "status": r.get("status", "not_started"),
                "reason": r.get("reason", ""),
                "milestone": r.get("milestone", ""),
            }
            for r in current
        ],
        "steps_total": len(current),
        "steps_completed": len([r for r in current if r["status"] == "completed"]),
    }


@router.post("", response_model=AssistantResponse)
def assistant(payload: AssistantRequest):
    if not OPENAI_API_KEY:
        raise HTTPException(500, "OPENAI_API_KEY not set in backend/.env")

    supabase = get_supabase()
    state = _load_state(supabase, payload.user_id)

    focus = ""
    if payload.context_course_id:
        step = next(
            (s for s in state["current_path"]
             if any(m["course_id"] == payload.context_course_id and m["title"] == s["title"]
                    for m in load_catalog().values())),
            None,
        )
        if step is None:
            for meta in load_catalog().values():
                if meta["course_id"] == payload.context_course_id:
                    step = next((s for s in state["current_path"] if s["title"] == meta["title"]), None)
                    break
        if step:
            focus = f"\nThe learner is asking specifically about this step: {json.dumps(step)}\n"

    # Recent conversation for continuity
    history_rows = (
        supabase.table("chat_messages")
        .select("role, content")
        .eq("user_id", payload.user_id)
        .order("created_at", desc=True)
        .limit(8)
        .execute()
        .data
    )
    history = list(reversed(history_rows))

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.append({
        "role": "system",
        "content": f"Learner's live state:\n{json.dumps(state, default=str)}{focus}",
    })
    for row in history:
        messages.append({"role": row["role"], "content": row["content"]})
    messages.append({"role": "user", "content": payload.message})

    client = OpenAI(api_key=OPENAI_API_KEY)
    resp = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=messages,
        temperature=0.4,
        response_format={"type": "json_object"},
    )
    raw = resp.choices[0].message.content.strip()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        parsed = json.loads(match.group(0)) if match else {}

    reply = (parsed.get("reply") or "").strip() or "Sorry — could you rephrase that?"
    action = parsed.get("action")
    if action not in ("regenerate_path",):
        action = None

    # --- Onboarding: persist anything new we learned about the learner ---
    profile_delta = parsed.get("profile") or {}
    if profile_delta:
        existing = (
            supabase.table("learner_profiles").select("*").eq("user_id", payload.user_id).execute().data
        )
        current = dict(existing[0]) if existing else {"user_id": payload.user_id}
        for key, value in profile_delta.items():
            if key not in ("goal", "interests", "skill_level", "known_topics"):
                continue
            if isinstance(value, list) and isinstance(current.get(key), list):
                current[key] = sorted(set(current[key]) | set(value))
            else:
                current[key] = value
        current["updated_at"] = datetime.now(timezone.utc).isoformat()
        supabase.table("learner_profiles").upsert(current).execute()

    supabase.table("chat_messages").insert(
        {"user_id": payload.user_id, "role": "user", "content": payload.message}
    ).execute()
    supabase.table("chat_messages").insert(
        {"user_id": payload.user_id, "role": "assistant", "content": reply}
    ).execute()

    return AssistantResponse(reply=reply, action=action)
