import json
import os
import re
from app.config import DATA_DIR

_catalog = None


def load_catalog() -> dict:
    """Loads data/courses_catalog.json — a dict keyed by course title.
    Generate this file first with scripts/build_catalog.py.
    """
    global _catalog
    if _catalog is None:
        path = os.path.join(DATA_DIR, "courses_catalog.json")
        if not os.path.exists(path):
            raise RuntimeError(
                "courses_catalog.json not found. Run: python scripts/build_catalog.py"
            )
        with open(path) as f:
            _catalog = json.load(f)
    return _catalog


def get_course(title: str) -> dict:
    catalog = load_catalog()
    return catalog.get(title, {
        "course_id": title,
        "title": title,
        "item_type": "course",
        "description": title,
        "level": "Unknown",
        "tags": [],
        "estimated_hours": 10,
        "prerequisites": [],
    })


def get_course_by_id(course_id: str) -> dict | None:
    for meta in load_catalog().values():
        if meta["course_id"] == course_id:
            return meta
    return None


def projects_and_resources_for(course_title: str) -> list[dict]:
    """Companion project/resource entries generated for a given course."""
    catalog = load_catalog()
    out = []
    for meta in catalog.values():
        if meta["item_type"] in ("project", "resource") and course_title in meta.get("prerequisites", []):
            out.append(meta)
        elif meta["item_type"] == "resource" and meta["course_id"].startswith(_slugify(course_title)):
            out.append(meta)
    return out


def _slugify(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
