from fastapi import APIRouter, HTTPException
from openai import OpenAI

from app.config import OPENAI_API_KEY, OPENAI_MODEL
from app.models import ExplainRequest, ExplainResponse
from app.engine.catalog import get_course
from app.supabase_client import get_supabase

router = APIRouter(prefix="/explain", tags=["explain"])


@router.post("", response_model=ExplainResponse)
def explain(payload: ExplainRequest):
    if not OPENAI_API_KEY:
        raise HTTPException(500, "OPENAI_API_KEY not set in backend/.env")

    supabase = get_supabase()
    profile_rows = (
        supabase.table("learner_profiles").select("*").eq("user_id", payload.user_id).execute().data
    )
    profile = profile_rows[0] if profile_rows else {}

    catalog = get_course(payload.course_id) if "-" not in payload.course_id else None
    # course_id passed from frontend is the slug; look it up by slug
    if catalog is None:
        from app.engine.catalog import load_catalog
        for title, meta in load_catalog().items():
            if meta["course_id"] == payload.course_id:
                catalog = meta
                break
    if catalog is None:
        raise HTTPException(404, "Course not found")

    client = OpenAI(api_key=OPENAI_API_KEY)
    prompt = f"""Learner profile: {profile}
Course: {catalog}

In 2-3 sentences, explain to the learner directly ("you") why this course
was recommended for them specifically, referencing their stated goal/level
where relevant. Be concrete, not generic.
"""
    resp = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.4,
    )
    return ExplainResponse(explanation=resp.choices[0].message.content.strip())
