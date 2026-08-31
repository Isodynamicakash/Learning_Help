from datetime import datetime, timezone, date, timedelta
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


def _compute_streak(completed_dates: list[date]) -> int:
    """Consecutive-day streak of completing at least one item.
    Counts back from today; if nothing today, today's grace is yesterday
    (so an active streak isn't shown as broken before the day is over)."""
    if not completed_dates:
        return 0
    unique_days = sorted(set(completed_dates), reverse=True)
    today = datetime.now(timezone.utc).date()

    if unique_days[0] == today:
        cursor = today
    elif unique_days[0] == today - timedelta(days=1):
        cursor = today - timedelta(days=1)
    else:
        return 0  # streak already broken

    streak = 0
    for day in unique_days:
        if day == cursor:
            streak += 1
            cursor -= timedelta(days=1)
        elif day < cursor:
            break
    return streak


@router.post("")
def update_progress(payload: ProgressUpdateRequest):
    supabase = get_supabase()
    update = {"status": payload.status}
    if payload.feedback:
        update["feedback"] = payload.feedback
    # Stamp completion time so streaks and history are computable.
    if payload.status == "completed":
        update["completed_at"] = datetime.now(timezone.utc).isoformat()
    supabase.table("path_items").update(update).eq(
        "user_id", payload.user_id
    ).eq("course_id", payload.course_id).execute()
    return {"ok": True}


@router.get("/{user_id}")
def get_progress(user_id: str):
    """Only ever returns items from the learner's CURRENT (most recent) path."""
    supabase = get_supabase()
    latest = _latest_path_id(supabase, user_id)

    all_rows = (
        supabase.table("path_items")
        .select("status, completed_at")
        .eq("user_id", user_id)
        .execute()
        .data
    )
    completed_dates = []
    for r in all_rows:
        if r["status"] == "completed" and r.get("completed_at"):
            try:
                completed_dates.append(
                    datetime.fromisoformat(r["completed_at"].replace("Z", "+00:00")).date()
                )
            except (ValueError, AttributeError):
                pass
    streak = _compute_streak(completed_dates)

    if not latest:
        return {
            "items": [], "total": 0, "completed": 0, "skill_gaps": [],
            "path_id": None, "streak": streak,
        }

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
        "streak": streak,
    }


@router.get("/{user_id}/skills")
def get_skill_development(user_id: str):
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
