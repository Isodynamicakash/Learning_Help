import json
import re
import uuid
from fastapi import APIRouter, HTTPException
from openai import OpenAI

from app.config import OPENAI_API_KEY, OPENAI_MODEL
from app.models import (
    PathGenerateRequest, PathGenerateResponse, PathStep, PathAdaptRequest,
)
from app.engine.recommender import top_related_courses
from app.engine.catalog import load_catalog, get_course, projects_and_resources_for
from app.supabase_client import get_supabase

router = APIRouter(prefix="/path", tags=["path"])


def _build_candidates(goal_text: str, known: list[str]) -> dict:
    """Course candidates from the recommender, plus their companion
    project/resource entries — so the path isn't 100% courses.
    top_k raised to 18 (from 10) so the LLM has enough breadth to build a
    path that actually spans the goal's full domain (fundamentals through
    advanced) instead of stopping after 4-5 shallow steps."""
    candidate_titles = top_related_courses(goal_text, top_k=18)
    candidates = {}
    for t in candidate_titles:
        if t in known:
            continue
        candidates[t] = get_course(t)
        for extra in projects_and_resources_for(t):
            candidates[extra["title"]] = extra
    return candidates


def _call_llm_for_steps(client, profile, candidates, extra_instruction=""):
    prompt = f"""Learner profile: {json.dumps(profile)}

Candidate items (courses, projects, and resources — with metadata,
including prerequisites where known):
{json.dumps(candidates, indent=2)}

Build an ordered learning path of 6-10 steps toward the learner's goal —
prefer the higher end of that range unless the candidate list genuinely
doesn't support it. The path must span the FULL breadth of what the goal
requires: don't stop after covering one or two foundational topics — go
from fundamentals through to the advanced/production-level skills implied
by the goal (e.g. for "backend engineer": language basics, one backend
framework, APIs, databases, testing, deployment/infra — not just the first
2-3 of those). Respect prerequisites and skill level. Include at least one
"project" item (hands-on practice) once its prerequisite course is placed,
and a "resource" item where it reinforces a course. {extra_instruction}

Also identify "skill_gaps": short list of skills/topics the goal requires
that are NOT in the learner's known_topics.

For each step return:
  "item_title" (must exactly match a candidate title),
  "reason" (1 sentence, why this step and why now),
  "milestone" (1 short phrase describing what they'll be able to do after it)

Return ONLY a JSON object: {{"skill_gaps": [...], "steps": [...]}}, no markdown fences.
"""
    resp = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        response_format={"type": "json_object"},
    )
    raw = resp.choices[0].message.content.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
        raise HTTPException(
            502, f"The AI returned a response that couldn't be parsed. Raw start: {raw[:200]!r}"
        )


@router.post("/generate", response_model=PathGenerateResponse)
def generate_path(payload: PathGenerateRequest):
    if not OPENAI_API_KEY:
        raise HTTPException(500, "OPENAI_API_KEY not set in backend/.env")

    supabase = get_supabase()
    profile_rows = (
        supabase.table("learner_profiles").select("*").eq("user_id", payload.user_id).execute().data
    )
    if not profile_rows:
        raise HTTPException(400, "No learner profile yet — talk to /chat first.")
    profile = profile_rows[0]

    goal_text = profile.get("goal", "") or " ".join(profile.get("interests", []))
    known = profile.get("known_topics", [])
    candidates = _build_candidates(goal_text, known)

    client = OpenAI(api_key=OPENAI_API_KEY)
    result = _call_llm_for_steps(client, profile, candidates)
    steps_raw = result.get("steps", [])
    skill_gaps = result.get("skill_gaps", [])

    # A learner may hit "Generate" more than once (new goal, redo, etc).
    # Only one path should ever be "current" — delete any previous
    # not-yet-completed items so the dashboard doesn't merge two paths'
    # step numbers together. Completed items stay untouched as history.
    supabase.table("path_items").delete().eq("user_id", payload.user_id).neq(
        "status", "completed"
    ).execute()

    path_id = str(uuid.uuid4())
    steps = []
    path_items_rows = []
    for i, s in enumerate(steps_raw, start=1):
        title = s["item_title"]
        meta = candidates.get(title) or get_course(title)
        steps.append(PathStep(
            order=i, course_id=meta["course_id"], title=title,
            item_type=meta.get("item_type", "course"),
            reason=s.get("reason", ""), milestone=s.get("milestone", ""),
        ))
        path_items_rows.append({
            "path_id": path_id, "user_id": payload.user_id, "order": i,
            "course_id": meta["course_id"], "title": title,
            "item_type": meta.get("item_type", "course"),
            "reason": s.get("reason", ""), "milestone": s.get("milestone", ""),
            "status": "not_started",
        })

    supabase.table("learning_paths").insert(
        {"path_id": path_id, "user_id": payload.user_id, "skill_gaps": skill_gaps}
    ).execute()
    supabase.table("path_items").insert(path_items_rows).execute()

    return PathGenerateResponse(path_id=path_id, steps=steps, skill_gaps=skill_gaps)


@router.post("/adapt", response_model=PathGenerateResponse)
def adapt_path(payload: PathAdaptRequest):
    """Re-plan the REMAINING (not-completed) steps of an existing path after
    feedback on one step (struggled / too easy / not relevant)."""
    if not OPENAI_API_KEY:
        raise HTTPException(500, "OPENAI_API_KEY not set in backend/.env")

    supabase = get_supabase()
    profile_rows = (
        supabase.table("learner_profiles").select("*").eq("user_id", payload.user_id).execute().data
    )
    if not profile_rows:
        raise HTTPException(400, "No learner profile found.")
    profile = dict(profile_rows[0])
    profile["latest_feedback"] = f"On '{payload.course_id}': {payload.feedback}"

    # mark feedback on the step itself
    supabase.table("path_items").update({"feedback": payload.feedback}).eq(
        "path_id", payload.path_id
    ).eq("course_id", payload.course_id).execute()

    existing_items = (
        supabase.table("path_items").select("*").eq("path_id", payload.path_id).order("order").execute().data
    )
    completed_titles = [r["title"] for r in existing_items if r["status"] == "completed"]
    remaining = [r for r in existing_items if r["status"] != "completed"]
    if not remaining:
        raise HTTPException(400, "No remaining steps to adapt — path is already complete.")

    known = list(set(profile.get("known_topics", []) + completed_titles))
    goal_text = profile.get("goal", "") or " ".join(profile.get("interests", []))
    candidates = _build_candidates(goal_text, known)

    client = OpenAI(api_key=OPENAI_API_KEY)
    extra = (
        "The learner already completed some steps (reflected in known_topics). "
        f"They just gave this feedback: '{payload.feedback}' on '{payload.course_id}'. "
        "If feedback is 'struggled', insert an easier/foundational item before continuing. "
        "If 'too_easy', skip ahead to a harder item. If 'not_relevant', drop items like it."
    )
    result = _call_llm_for_steps(client, profile, candidates, extra_instruction=extra)
    steps_raw = result.get("steps", [])
    skill_gaps = result.get("skill_gaps", [])

    # delete old not-completed items, insert the re-planned remainder after the completed ones
    supabase.table("path_items").delete().eq("path_id", payload.path_id).neq("status", "completed").execute()

    start_order = len(completed_titles) + 1
    steps = []
    new_rows = []
    for i, s in enumerate(steps_raw, start=start_order):
        title = s["item_title"]
        meta = candidates.get(title) or get_course(title)
        steps.append(PathStep(
            order=i, course_id=meta["course_id"], title=title,
            item_type=meta.get("item_type", "course"),
            reason=s.get("reason", ""), milestone=s.get("milestone", ""),
        ))
        new_rows.append({
            "path_id": payload.path_id, "user_id": payload.user_id, "order": i,
            "course_id": meta["course_id"], "title": title,
            "item_type": meta.get("item_type", "course"),
            "reason": s.get("reason", ""), "milestone": s.get("milestone", ""),
            "status": "not_started",
        })
    if new_rows:
        supabase.table("path_items").insert(new_rows).execute()
    supabase.table("learning_paths").update({"skill_gaps": skill_gaps}).eq("path_id", payload.path_id).execute()

    return PathGenerateResponse(path_id=payload.path_id, steps=steps, skill_gaps=skill_gaps)
