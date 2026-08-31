"""
Builds data/courses_catalog.json from the 80 unique course titles in train.csv.

Your CSVs only contain review text + course name — no description, level,
tags, prerequisites, or duration. Those fields don't exist anywhere in your
data, so the path generator and dashboard have nothing to render without
them. This script fabricates that metadata:

  - If OPENAI_API_KEY is set in backend/.env: asks the model to write a
    short description, level, tags, and estimated hours per course, propose
    prerequisite links between courses that look related ("SQL for
    Beginners" -> "Advanced SQL and Query Optimization"), AND generate one
    companion hands-on PROJECT and one companion RESOURCE per course, so
    recommendations aren't 100% courses (per the "courses, projects, and
    learning resources" requirement). All entries share the same schema
    plus an "item_type" field: "course" | "project" | "resource".
  - If no key is set: falls back to a deterministic heuristic (keyword-based
    level detection, no prerequisites, no generated projects/resources) so
    the app still runs end-to-end for local testing without burning API
    credits.

Run: python scripts/build_catalog.py
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app.config import OPENAI_API_KEY, OPENAI_MODEL, DATA_DIR

COURSE_NAMES_PATH = os.path.join(DATA_DIR, "course_names.json")
OUTPUT_PATH = os.path.join(DATA_DIR, "courses_catalog.json")


def slugify(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")


def heuristic_level(title: str) -> str:
    t = title.lower()
    if "beginner" in t or "basics" in t or "for beginners" in t or "introduction" in t:
        return "Beginner"
    if "advanced" in t:
        return "Advanced"
    return "Intermediate"


def build_offline(course_names: list[str]) -> dict:
    catalog = {}
    for title in course_names:
        catalog[title] = {
            "course_id": slugify(title),
            "title": title,
            "item_type": "course",
            "description": f"A course covering the core concepts, tools and hands-on practice for {title}.",
            "level": heuristic_level(title),
            "tags": [w for w in re.findall(r"[A-Za-z]+", title) if len(w) > 2][:5],
            "estimated_hours": 12,
            "prerequisites": [],
        }
    return catalog


def build_with_openai(course_names: list[str]) -> dict:
    from openai import OpenAI

    client = OpenAI(api_key=OPENAI_API_KEY)

    # Batch in chunks of 20 courses per call — keeps each response small and
    # reliable to parse instead of one giant 80-course JSON blob.
    catalog = {}
    chunk_size = 20
    for start in range(0, len(course_names), chunk_size):
        chunk = course_names[start:start + chunk_size]
        prompt = f"""You are designing a learning platform catalog.
Given this list of course titles, return a JSON object keyed by the exact
course title. Each value must have:
  - "description": 1-2 sentence description of what the course teaches
  - "level": one of "Beginner", "Intermediate", "Advanced"
  - "tags": 3-5 short skill/topic tags (single words or short phrases)
  - "estimated_hours": integer, realistic study hours (5-40)
  - "prerequisites": array of course titles from THIS SAME list that a
    learner should ideally complete first (empty array if none apply;
    infer from naming patterns, e.g. a "Beginners"/"Basics" course is a
    prerequisite for a corresponding "Advanced" one on the same topic)
  - "project": an object {{"title": "...", "description": "1 sentence hands-on
    project applying this course's skills"}}
  - "resource": an object {{"title": "...", "description": "1 sentence on a
    type of supplementary resource (cheat sheet, reference doc, practice
    set) that reinforces this course — do NOT invent a fake URL"}}

Course titles:
{json.dumps(chunk, indent=2)}

Return ONLY the JSON object, no markdown fences, no preamble.
"""
        resp = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
        )
        raw = resp.choices[0].message.content.strip()
        raw = re.sub(r"^```json|```$", "", raw.strip(), flags=re.MULTILINE).strip()
        data = json.loads(raw)

        for title in chunk:
            entry = data.get(title, {})
            base_slug = slugify(title)
            tags = entry.get("tags", [])
            level = entry.get("level", heuristic_level(title))

            catalog[title] = {
                "course_id": base_slug,
                "title": title,
                "item_type": "course",
                "description": entry.get("description", title),
                "level": level,
                "tags": tags,
                "estimated_hours": entry.get("estimated_hours", 12),
                "prerequisites": entry.get("prerequisites", []),
            }

            proj = entry.get("project", {})
            if proj.get("title"):
                proj_title = f"Project: {proj['title']}"
                catalog[proj_title] = {
                    "course_id": f"{base_slug}-project",
                    "title": proj_title,
                    "item_type": "project",
                    "description": proj.get("description", ""),
                    "level": level,
                    "tags": tags,
                    "estimated_hours": max(4, entry.get("estimated_hours", 12) // 2),
                    "prerequisites": [title],
                }

            res = entry.get("resource", {})
            if res.get("title"):
                res_title = f"Resource: {res['title']}"
                catalog[res_title] = {
                    "course_id": f"{base_slug}-resource",
                    "title": res_title,
                    "item_type": "resource",
                    "description": res.get("description", ""),
                    "level": level,
                    "tags": tags,
                    "estimated_hours": 2,
                    "prerequisites": [],
                }
        print(f"  ...{min(start + chunk_size, len(course_names))}/{len(course_names)} courses done")
    return catalog


if __name__ == "__main__":
    with open(COURSE_NAMES_PATH) as f:
        course_names = json.load(f)

    if OPENAI_API_KEY:
        print(f"Generating catalog metadata for {len(course_names)} courses via OpenAI...")
        catalog = build_with_openai(course_names)
    else:
        print("No OPENAI_API_KEY set — building offline heuristic catalog instead.")
        catalog = build_offline(course_names)

    with open(OUTPUT_PATH, "w") as f:
        json.dump(catalog, f, indent=2)
    print(f"Wrote {OUTPUT_PATH}")
