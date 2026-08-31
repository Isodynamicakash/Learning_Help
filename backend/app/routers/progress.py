from fastapi import APIRouter, HTTPException
from app.models import ProgressUpdateRequest
from app.supabase_client import get_supabase
from app.engine.catalog import get_course

router = APIRouter(prefix="/progress", tags=["progress"])


def _latest_path_id(supabase, user_id: str):
    rows = (
        supabase.table("learning_paths")
        .select("path_id, skill_gaps")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else None


@router.post("")
def update_progress(payload: ProgressUpdateRequest):
    supabase = get_supabase()
    update = {"status": payload.status}
    if payload.feedback:
        update["feedback"] = payload.feedback
    supabase.table("path_items").update(update).eq(
        "user_id", payload.user_id
    ).eq("course_id", payload.course_id).execute()
    return {"ok": True}


@router.get("/{user_id}")
def get_progress(user_id: str):
    """Only ever returns items from the learner's CURRENT (most recent) path.
    Older, superseded paths are ignored here so re-generating a path doesn't
    merge two different step-1s together."""
    supabase = get_supabase()
    latest = _latest_path_id(supabase, user_id)
    if not latest:
        return {"items": [], "total": 0, "completed": 0, "skill_gaps": [], "path_id": None}

    rows = (
        supabase.table("path_items")
        .select("*")
        .eq("user_id", user_id)
        .eq("path_id", latest["path_id"])
        .order("order")
        .execute()
        .data
    )
    total = len(rows)
    done = len([r for r in rows if r["status"] == "completed"])
    return {
        "items": rows,
        "total": total,
        "completed": done,
        "skill_gaps": latest.get("skill_gaps", []),
        "path_id": latest["path_id"],
    }


@router.get("/{user_id}/skills")
def get_skill_development(user_id: str):
    """Aggregates catalog tags from COMPLETED steps (across all-time, since
    completed work is still real progress even after a path gets replaced)
    into a simple skill inventory."""
    supabase = get_supabase()
    rows = (
        supabase.table("path_items")
        .select("title, status")
        .eq("user_id", user_id)
        .eq("status", "completed")
        .execute()
        .data
    )
    tag_counts: dict[str, int] = {}
    for r in rows:
        meta = get_course(r["title"])
        for tag in meta.get("tags", []):
            tag_counts[tag] = tag_counts.get(tag, 0) + 1

    skills = sorted(
        [{"tag": t, "strength": c} for t, c in tag_counts.items()],
        key=lambda x: -x["strength"],
    )
    return {"skills": skills, "completed_count": len(rows)}