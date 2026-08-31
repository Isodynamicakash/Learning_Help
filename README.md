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


