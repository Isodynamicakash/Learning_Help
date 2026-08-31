# Personalized Learning Path Recommender

Built on your round-1 data (`Reviews` → `Course`, 80 courses). Your CSVs have
no catalog metadata (description/level/prerequisites), so the catalog is
synthesized once via OpenAI from the 80 course titles — see "Why" below.

## What's here
- `backend/` — FastAPI. Chat (profiling), recommend, path generation,
  explainability, progress — all backed by Supabase + your classify-then-
  retrieve model (100% val accuracy vs your original ~70-80%).
- `frontend/` — Next.js. Email magic-link login (Supabase Auth), chat
  onboarding, dashboard with generated path + progress tracking.

## Setup — do these in order

### 1. Supabase project
1. Create a project at supabase.com.
2. SQL Editor → paste and run `backend/supabase_schema.sql`.
3. Authentication → Providers → make sure **Email** is enabled (magic link).
4. Settings → API → copy your Project URL, `anon` public key, and
   `service_role` key (keep the service key secret).

### 2. Backend
```bash
cd backend
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env       # fill in OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
python scripts/build_catalog.py     # generates data/courses_catalog.json (needs OPENAI_API_KEY)
uvicorn app.main:app --reload --port 8000
```
The trained model (`data/vectorizer.pkl`, `data/classifier.pkl`) is already
included, trained on your `train.csv`. To retrain from scratch or regenerate
your improved round-1 submission: `python scripts/generate_submission_v2.py`.

### 3. Frontend
```bash
cd frontend
npm install
cp .env.local.example .env.local   # fill in NEXT_PUBLIC_SUPABASE_URL / ANON_KEY
npm run dev
```
Open http://localhost:3000 — sign in with email (magic link), chat about
your goal, then go to Dashboard → Generate my learning path.

## Why some things were built the way they were
- **Catalog metadata is fabricated.** Your data only has review text +
  course name — no description/level/prerequisites anywhere. `build_catalog.py`
  asks OpenAI to write that metadata once (cached to JSON) instead of
  inventing it by hand for 80 courses.
- **Recommendation engine = your model, upgraded.** Classify course first
  (near-perfect separability, verified locally), then retrieve top-N within
  that course. Same idea as your submission.csv, reused as a library
  (`app/engine/recommender.py`) instead of a one-off script.
- **service_role key stays server-side only.** The frontend only ever gets
  the `anon` key; all writes to learner data go through the FastAPI backend.

## Round 2 additions (skill gaps, projects/resources, skill dashboard, adaptation)
- **Projects & resources**: `build_catalog.py` now generates one companion
  project and one resource per course (item_type: course/project/resource).
  Path generation pulls from all three, not just courses.
- **Skill gaps**: every `/path/generate` and `/path/adapt` call also returns
  `skill_gaps` — topics the goal needs that aren't in `known_topics` — shown
  on the dashboard.
- **Skill development view**: `GET /progress/{user_id}/skills` aggregates
  catalog tags from completed steps into a simple strength-by-tag list,
  rendered as bars on the dashboard. It's evidence-of-coverage, not a real
  competency test.
- **Adaptive path**: dashboard has "Struggled — adjust path" / "Too easy —
  skip ahead" buttons per step, calling `/path/adapt`, which re-plans only
  the remaining (not-completed) steps around the feedback and the learner's
  updated known_topics.
- If you ran `supabase_schema.sql` before this update, re-run it — the new
  version adds the missing columns with `ADD COLUMN IF NOT EXISTS`, safe to
  re-run without losing data. Also re-run `python scripts/build_catalog.py`
  to regenerate the catalog with project/resource entries (this makes more
  OpenAI calls than before — chunked 20 courses at a time, ~4 calls total).

## Not yet wired up (needs your input)
- RLS policies in `supabase_schema.sql` are permissive placeholders (backend
  uses the service key, which bypasses RLS anyway). Tighten before any real
  deployment.
- No rate limiting / auth check on the FastAPI routes themselves — anyone
  who can reach the backend URL can call them. Fine for a local demo, not
  for a public deploy.
- Deployment (Vercel for frontend, Render/Railway for backend) isn't set up
  — say the word and I'll add configs for whichever you pick.
- Skill gap / skill development are heuristic, not psychometric — fine for
  a demo, don't oversell it as an assessment engine if judges probe it.
