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


def _seen_titles(supabase, user_id: str):
    """All items ever shown to this learner, split into completed vs
    not-completed. Used so regenerating actually explores new ground
    instead of reproducing the same deterministic classifier output."""
    rows = (
        supabase.table("path_items").select("title, status").eq("user_id", user_id).execute().data
    )
    completed = [r["title"] for r in rows if r["status"] == "completed"]
    shown_not_completed = [r["title"] for r in rows if r["status"] != "completed"]
    return completed, shown_not_completed


def _build_candidates(goal_text: str, known: list[str]) -> dict:
    """Course candidates from the recommender, plus their companion
    project/resource entries. top_k=40 (roughly half the catalog) gives the
    model real breadth to work with for a comprehensive path. Only excludes
    items the learner has actually completed (known_topics + completed
    history) — items merely shown before but not finished remain eligible,
    since "not completed yet" isn't a reason to hide something."""
    known_set = set(known)
    candidate_titles = top_related_courses(goal_text, top_k=40)
    candidates = {}
    for t in candidate_titles:
        if t in known_set:
            continue
        candidates[t] = get_course(t)
        for extra in projects_and_resources_for(t):
            candidates[extra["title"]] = extra
    return candidates


def _call_llm_for_steps(client, profile, candidates, extra_instruction="", temperature=0.3):
    prompt = f"""Learner profile: {json.dumps(profile)}

Note: "known_topics" and "already_completed" (if present) both represent
things the learner has already finished — never suggest these again, and
treat them as the foundation the path should build forward from.

Candidate items (courses, projects, and resources — with metadata,
including prerequisites where known):
{json.dumps(candidates, indent=2)}

Build an ordered learning path of 6-10 steps toward the learner's goal —
prefer the higher end of that range unless the candidate list genuinely
doesn't support it.

HARD RULE on difficulty: the path must START at the learner's stated
skill_level and climb from there. If they are a Beginner, step 1 must be a
Beginner-level item — never open with an "Advanced" or "Masterclass" item
and never place an Advanced item before its Beginner/Intermediate
counterpart on the same topic. Every item you place must be one the learner
can actually start given what precedes it.

The path must span the FULL breadth of what the goal
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
        temperature=temperature,
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

    completed_history, shown_not_completed = _seen_titles(supabase, payload.user_id)
    goal_text = profile.get("goal", "") or " ".join(profile.get("interests", []))
    known = list(set(profile.get("known_topics", []) + completed_history))
    candidates = _build_candidates(goal_text, known)

    # Feed the FULL known list back into what the AI actually sees — without
    # this, the model only sees whatever was in chat-derived known_topics,
    # never what the learner has actually completed inside the app.
    profile = dict(profile)
    profile["known_topics"] = known
    if completed_history:
        profile["already_completed"] = completed_history

    is_regenerate = bool(shown_not_completed)
    extra = (
        "This is a REGENERATE — the learner already saw a previous path. "
        "Feel free to keep good items from before, but reconsider the "
        "ordering, reasoning, and mix rather than just repeating the exact "
        "same list mechanically. "
        if is_regenerate else ""
    )
    if completed_history:
        extra += (
            f"The learner has ALREADY COMPLETED: {', '.join(completed_history)}. "
            "Build on that — don't re-suggest these, and treat them as a "
            "foundation the next steps should follow from."
        )

    client = OpenAI(api_key=OPENAI_API_KEY)
    result = _call_llm_for_steps(
        client, profile, candidates, extra_instruction=extra,
        temperature=0.55 if is_regenerate else 0.3,
    )
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

    supabase.table("path_items").update({"feedback": payload.feedback}).eq(
        "path_id", payload.path_id
    ).eq("course_id", payload.course_id).execute()

    existing_items = (
        supabase.table("path_items").select("*").eq("path_id", payload.path_id).order("order").execute().data
    )
    if not existing_items:
        raise HTTPException(404, "That path no longer exists — generate a new one.")

    completed_titles = [r["title"] for r in existing_items if r["status"] == "completed"]
    remaining = [r for r in existing_items if r["status"] != "completed"]
    if not remaining:
        raise HTTPException(400, "No remaining steps to adapt — path is already complete.")

    # Also pull completed history from any OTHER past paths — the AI should
    # know everything the learner has ever finished, not just this path's.
    all_completed_history, _ = _seen_titles(supabase, payload.user_id)
    known = list(set(profile.get("known_topics", []) + completed_titles + all_completed_history))
    goal_text = profile.get("goal", "") or " ".join(profile.get("interests", []))
    candidates = _build_candidates(goal_text, known)

    if not candidates:
        raise HTTPException(
            502, "Couldn't find any candidate courses for this goal — try rephrasing your goal in chat."
        )

    # Feed the full known/completed picture back into what the AI sees.
    profile["known_topics"] = known
    profile["already_completed"] = list(set(completed_titles + all_completed_history))

    client = OpenAI(api_key=OPENAI_API_KEY)
    extra = (
        f"The learner has ALREADY COMPLETED: {', '.join(known) or 'nothing yet'}. "
        f"They just gave this feedback: '{payload.feedback}' on '{payload.course_id}'.\n"
        "Apply the feedback by RE-ORDERING, not just by swapping items:\n"
        "- 'struggled': keep that item in the path, but move it LATER, and place "
        "one or two easier/foundational prerequisite items BEFORE it so they can "
        "build up to it. The easier items must come first in the returned order.\n"
        "- 'too_easy': drop that item (or move it much later) and bring more "
        "advanced items EARLIER so they skip ahead.\n"
        "- 'not_relevant': remove it and anything similar.\n"
        "Return the remaining steps in the exact order the learner should do them."
    )
    result = _call_llm_for_steps(client, profile, candidates, extra_instruction=extra, temperature=0.3)
    steps_raw = result.get("steps", [])
    skill_gaps = result.get("skill_gaps", [])

    if not steps_raw:
        raise HTTPException(502, "The AI didn't return any steps — try again.")

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
