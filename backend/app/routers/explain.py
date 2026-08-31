from fastapi import APIRouter, HTTPException
from openai import OpenAI

from app.config import OPENAI_API_KEY, OPENAI_MODEL
from app.models import ExplainRequest, ExplainResponse
from app.engine.catalog import get_course, load_catalog
from app.supabase_client import get_supabase

router = APIRouter(prefix="/explain", tags=["explain"])


def _find_course_meta(course_id: str):
    """course_id from the frontend is a slug — resolve it against the catalog."""
    for meta in load_catalog().values():
        if meta["course_id"] == course_id:
            return meta
    return get_course(course_id)


@router.post("", response_model=ExplainResponse)
def explain(payload: ExplainRequest):
    if not OPENAI_API_KEY:
        raise HTTPException(500, "OPENAI_API_KEY not set in backend/.env")

    supabase = get_supabase()

    profile_rows = (
        supabase.table("learner_profiles").select("*").eq("user_id", payload.user_id).execute().data
    )
    profile = dict(profile_rows[0]) if profile_rows else {}

    # --- Full learner context: everything they've ever done, plus the
    # current path in order. Without this the model re-judges the course in
    # isolation and ends up arguing against the very path it generated.
    all_items = (
        supabase.table("path_items")
        .select("*")
        .eq("user_id", payload.user_id)
        .order("order")
        .execute()
        .data
    )
    completed_titles = sorted({r["title"] for r in all_items if r["status"] == "completed"})

    latest_path = (
        supabase.table("learning_paths")
        .select("path_id")
        .eq("user_id", payload.user_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    current_path_id = latest_path[0]["path_id"] if latest_path else None
    current_items = [r for r in all_items if r["path_id"] == current_path_id]

    this_step = next((r for r in current_items if r["course_id"] == payload.course_id), None)

    meta = _find_course_meta(payload.course_id)
    if meta is None:
        raise HTTPException(404, "Course not found")

    path_summary = [
        {
            "order": r["order"],
            "title": r["title"],
            "type": r.get("item_type", "course"),
            "status": r.get("status", "not_started"),
            "planner_reason": r.get("reason", ""),
            "milestone": r.get("milestone", ""),
        }
        for r in current_items
    ]

    if this_step:
        context_block = f"""This item IS step {this_step['order']} of the learner's current path.
When the path was generated, the planner's stated reason for placing it here was:
  "{this_step.get('reason', '')}"
Its milestone is: "{this_step.get('milestone', '')}"
Its current status is: {this_step.get('status', 'not_started')}"""
        task = """Explain to the learner (address them as "you") why THIS step sits where
it does in their plan: what it builds on from earlier steps or from what
they've already completed, what it unlocks for the steps that follow, and
how it moves them toward their goal. You are explaining a plan that already
exists — do NOT argue the item shouldn't be recommended, and do not suggest
replacing it. If its difficulty looks like a stretch given their level,
frame that as what to focus on or how to prepare, not as a reason to skip it.
Keep it to 2-4 sentences, concrete and specific to their situation."""
    else:
        context_block = "This item is NOT currently part of the learner's path."
        task = """Explain to the learner (address them as "you") how this item relates to
their goal and what they've already completed, and whether it would fit
their current plan. Keep it to 2-4 sentences, concrete and specific."""

    client = OpenAI(api_key=OPENAI_API_KEY)
    prompt = f"""Learner profile: {profile}

Items the learner has ALREADY COMPLETED: {completed_titles or "none yet"}

Their current learning path, in order:
{path_summary}

The item being asked about:
{meta}

{context_block}

{task}
"""
    resp = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.4,
    )
    return ExplainResponse(explanation=resp.choices[0].message.content.strip())
