import json
import re
from fastapi import APIRouter, HTTPException
from openai import OpenAI
from app.config import OPENAI_API_KEY, OPENAI_MODEL
from app.models import ChatMessageIn, ChatMessageOut
from app.supabase_client import get_supabase

router = APIRouter(prefix="/chat", tags=["chat"])

SYSTEM_PROMPT = """You are a learning path assistant. Talk to the learner
naturally and figure out: their goal, interests, current skill level
(Beginner/Intermediate/Advanced), and any courses/skills they already know.

You must respond with a JSON object with exactly these keys:
  "reply": a short, friendly natural-language message to show the learner —
           this is the ONLY text the learner will see, so it must read as a
           complete, natural chat message on its own. Never mention JSON,
           profiles, or say things like "here's your updated profile" —
           just talk to them normally.
  "profile": an object with any of "goal", "interests" (list), "skill_level",
             "known_topics" (list) that you were able to extract so far —
             omit keys you don't know yet, never invent values.
"""


def _extract_json_object(raw: str) -> dict:
    """The model is asked for strict JSON via response_format, but as a
    safety net (older models, edge cases) this pulls the {...} block out of
    surrounding prose if the model still wraps it in chatter."""
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass
    return {}


@router.get("/profile/{user_id}")
def get_profile(user_id: str):
    supabase = get_supabase()
    rows = (
        supabase.table("learner_profiles").select("*").eq("user_id", user_id).execute().data
    )
    return rows[0] if rows else {}


@router.post("", response_model=ChatMessageOut)
def chat(payload: ChatMessageIn):
    if not OPENAI_API_KEY:
        raise HTTPException(500, "OPENAI_API_KEY not set in backend/.env")

    supabase = get_supabase()

    # Pull prior chat history for this user for context
    history_rows = (
        supabase.table("chat_messages")
        .select("role, content")
        .eq("user_id", payload.user_id)
        .order("created_at")
        .execute()
        .data
    )
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for row in history_rows:
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
    parsed = _extract_json_object(raw)

    reply = parsed.get("reply", "").strip()
    profile_delta = parsed.get("profile", {})

    # Never show the learner raw JSON/unparsed model output — if parsing
    # genuinely failed and there's no usable reply, fall back to a clean
    # generic message instead of leaking internals.
    if not reply:
        reply = "Got it — tell me a bit more about what you're aiming for?"

    # persist chat turn
    supabase.table("chat_messages").insert(
        {"user_id": payload.user_id, "role": "user", "content": payload.message}
    ).execute()
    supabase.table("chat_messages").insert(
        {"user_id": payload.user_id, "role": "assistant", "content": reply}
    ).execute()

    profile_updated = False
    merged_profile = None
    if profile_delta:
        existing = (
            supabase.table("learner_profiles")
            .select("*")
            .eq("user_id", payload.user_id)
            .execute()
            .data
        )
        current = existing[0] if existing else {"user_id": payload.user_id}

        # merge lists, overwrite scalars
        for key, value in profile_delta.items():
            if isinstance(value, list) and isinstance(current.get(key), list):
                current[key] = sorted(set(current[key]) | set(value))
            else:
                current[key] = value

        supabase.table("learner_profiles").upsert(current).execute()
        merged_profile = current
        profile_updated = True

    return ChatMessageOut(reply=reply, profile_updated=profile_updated, profile=merged_profile)
