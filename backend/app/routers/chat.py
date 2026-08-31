import json
from fastapi import APIRouter, HTTPException
from openai import OpenAI
from app.config import OPENAI_API_KEY, OPENAI_MODEL
from app.models import ChatMessageIn, ChatMessageOut
from app.supabase_client import get_supabase

router = APIRouter(prefix="/chat", tags=["chat"])

SYSTEM_PROMPT = """You are a learning path assistant. Talk to the learner
naturally and figure out: their goal, interests, current skill level
(Beginner/Intermediate/Advanced), and any courses/skills they already know.

Always reply with a JSON object with exactly these keys:
  "reply": a short, friendly natural-language message to show the learner
  "profile": an object with any of "goal", "interests" (list), "skill_level",
             "known_topics" (list) that you were able to extract so far —
             omit keys you don't know yet, never invent values.

Return ONLY that JSON object, no markdown fences.
"""


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
    )
    raw = resp.choices[0].message.content.strip()
    raw = raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip()

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = {"reply": raw, "profile": {}}

    reply = parsed.get("reply", "")
    profile_delta = parsed.get("profile", {})

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