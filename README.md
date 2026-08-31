# Pathwise — AI-Powered Personalized Learning Path Recommender

An intelligent learning assistant that profiles a learner through conversation,
recommends courses/projects/resources, generates an ordered learning roadmap
with prerequisites and milestones, explains every recommendation, and adapts
the remaining path based on progress and feedback.

**Live app:** https://learning-help.vercel.app
**API:** https://learninghelp-production.up.railway.app

---

## 1. Architecture

```
Next.js (Vercel)  --HTTP-->  FastAPI (Railway)  -->  Supabase (Postgres + Auth)
                                    |
                                    |-> TF-IDF + SGDClassifier  (trained ML model)
                                    |-> OpenAI API              (reasoning + language)
```

| Layer | Tech | Responsibility |
|---|---|---|
| Frontend | Next.js 14 (App Router), React 18 | Dashboard, auth screens, floating assistant |
| Backend | FastAPI, Python 3.12 | Recommendation engine, path planner, explainability |
| Database | Supabase (Postgres) | Profiles, paths, path items, chat history |
| Auth | Supabase Auth | Email + password |
| ML | scikit-learn (TF-IDF + SGDClassifier) | Course prediction from free text |
| LLM | OpenAI (gpt-4o-mini) | Conversation, planning, explanations |

---

## 2. What is ML vs what is the LLM

This distinction matters — they solve different problems.

### Trained ML (scikit-learn) — the recommendation engine

- **Data:** 109,777 course reviews across 80 courses (`Reviews` -> `Course`).
- **Model:** TF-IDF (unigrams + bigrams, 20k features, sublinear tf) ->
  `SGDClassifier` (log-loss).
- **Validation:** **100% accuracy** on a 15% stratified hold-out split.
- **Inference:** classify the learner's free-text goal to a course, then
  cosine-rank *within that predicted course* — "classify then retrieve".
- **Why this design:** the original approach ran cosine similarity across all
  109k reviews at once and scored ~70-80%. Review templates repeat across
  different courses ("the instructor could improve..."), so raw similarity
  pulled in wrong-course matches. Classifying first removes that failure mode.
- `top_related_courses()` uses the classifier's per-class decision scores to
  return a ranked candidate set (top 40), not just a single best match.

### OpenAI — everything requiring language or reasoning

| Feature | Why an LLM, not ML |
|---|---|
| Conversational profiling | Free text to structured fields. No labelled dataset exists to train on. |
| Catalog metadata generation | The dataset has no descriptions, levels, prerequisites, or durations. Generated once, cached to JSON. |
| Path sequencing | Ordering candidates under prerequisite and skill-level constraints. No ground-truth "correct path" data to train against. |
| Explainability | Natural-language generation. |
| Adaptive replanning | Same reasoning task, re-run against new feedback. |

**Summary:** ML answers *"which course does this text refer to"* — a real
prediction problem with a measurable accuracy figure. The LLM handles
conversation, content synthesis, sequencing, and explanation — tasks with no
training data available.

---

## 3. Features and where they live

| Requirement | Implementation |
|---|---|
| Conversational interface | Floating assistant widget (`AssistantWidget.js`) -> `POST /assistant` |
| Learner profiling engine | `/assistant` extracts goal, skill level, interests, known topics -> `learner_profiles` |
| Recommendation engine (courses, projects, resources) | `engine/recommender.py` + `engine/catalog.py`; every course has a generated companion project and resource |
| Path generator with prerequisites + milestones | `POST /path/generate` — 6-10 ordered steps, hard skill-level floor, each with reason + milestone |
| Skill gap identification | Returned with every path, stored on `learning_paths.skill_gaps` |
| Explains each recommendation | `POST /explain` — path-aware: sees the full path, step position, planner's stored reason, and completed history |
| Answers learner queries | `POST /assistant` — reloads full live state before every answer |
| Adapts to feedback and progress | `POST /path/adapt` — "Struggled" moves the item later and inserts prerequisites before it; "Too easy" pulls advanced items earlier |
| Dashboard: progress, milestones, next action | Goal card, progress bar, "Next up" card, milestone on every step |
| Dashboard: skill development | `GET /progress/{id}/skills` — tag frequency across completed items |
| Streak | `GET /progress/{id}` — consecutive days with at least one completion, from `completed_at` |

---

## 4. API

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | Liveness check |
| POST | `/assistant` | Context-aware chat; profiling + can trigger `regenerate_path` |
| POST | `/chat` | Legacy profiling endpoint (kept for compatibility) |
| GET | `/chat/profile/{user_id}` | Read learner profile |
| POST | `/recommend` | Course recommendations for free text |
| POST | `/path/generate` | Build a new ordered path |
| POST | `/path/adapt` | Re-plan remaining steps after feedback |
| POST | `/explain` | Path-aware explanation for one step |
| POST | `/progress` | Mark a step complete / in progress, attach feedback |
| GET | `/progress/{user_id}` | Current path, completion, skill gaps, streak |
| GET | `/progress/{user_id}/skills` | Aggregated skill development |

---

## 5. Data model (Supabase)

```
learner_profiles (user_id PK, goal, interests[], skill_level, known_topics[], updated_at)
chat_messages    (id, user_id, role, content, created_at)
learning_paths   (path_id PK, user_id, skill_gaps[], created_at)
path_items       (id, path_id FK, user_id, order, course_id, title, item_type,
                  reason, milestone, status, feedback, completed_at, created_at)
```

`item_type` is one of course / project / resource.
`status` is one of not_started / in_progress / completed.

---

## 6. Local setup

### Prerequisites
Python **3.12** (3.13/3.14 lack prebuilt wheels for scikit-learn), Node 18+.

### Supabase
1. Create a project.
2. SQL Editor -> run `backend/supabase_schema.sql`.
3. Authentication -> Providers -> Email enabled, **Confirm email off** for demos.
4. Settings -> API -> copy Project URL, `anon` key, `service_role` key.

### Backend
```bash
cd backend
py -3.12 -m venv venv
venv\Scripts\activate          # macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
copy .env.example .env         # then fill in keys
python scripts/build_catalog.py    # generates data/courses_catalog.json
uvicorn app.main:app --reload --port 8000
```

`backend/.env`:
```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_KEY=<service_role key>   # server-side only, never in frontend
```

### Frontend
```bash
cd frontend
npm install
copy .env.local.example .env.local
npm run dev
```

`frontend/.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
NEXT_PUBLIC_API_BASE=http://localhost:8000
```

Open http://localhost:3000.

---

## 7. Deployment

**Backend to Railway:** root directory `backend`, start command
`uvicorn app.main:app --host 0.0.0.0 --port $PORT`, env vars as above.
Generate a public domain under Settings -> Networking.

**Frontend to Vercel:** root directory `frontend`, framework auto-detected.
Env vars as above with `NEXT_PUBLIC_API_BASE` pointing at the Railway URL
(no trailing slash). All `NEXT_PUBLIC_*` vars must be type **Config**, not Secret.

**Supabase:** Authentication -> URL Configuration -> add the Vercel URL to
Site URL and Redirect URLs.

---

## 8. Reproducing the Round 1 result

```bash
cd backend
python scripts/generate_submission_v2.py
```
Trains the classifier, writes `data/submission_v2.csv` (10,977 rows), and
refreshes the `.pkl` model files the API loads at runtime.

---

## 9. Known limitations

Stated plainly rather than glossed over:

- **Catalog is 80 courses**, all derived from the Round 1 dataset. Goals outside
  its subject coverage (for example "learn R") produce weaker paths — the
  planner can only order what exists.
- **Course metadata is LLM-generated**, not sourced. Descriptions, levels,
  durations and prerequisite links are plausible but not authoritative.
- **Skill gaps and skill development are heuristic** — an LLM-inferred gap list
  and tag-frequency over completed items. Not a psychometric assessment.
- **RLS policies are permissive.** The backend uses the `service_role` key,
  which bypasses RLS anyway; the anon key never writes directly. Would need
  `auth.uid()`-scoped policies before real production use.
- **No auth check on FastAPI routes.** Anyone who can reach the API URL can call
  it with an arbitrary `user_id`. Acceptable for a demo, not for production.
- **scikit-learn version drift** — the `.pkl` files were trained on a different
  minor version than Railway resolves, producing an `InconsistentVersionWarning`.
  Harmless today; pin the version to remove it.

---

## 10. Repository layout

```
app/
├── backend/
│   ├── app/
│   │   ├── engine/          recommender.py, catalog.py
│   │   ├── routers/         assistant, chat, path, explain, progress, recommend
│   │   ├── config.py  main.py  models.py  supabase_client.py
│   ├── data/                train.csv, *.pkl, courses_catalog.json
│   ├── scripts/             build_catalog.py, generate_submission_v2.py
│   ├── requirements.txt     supabase_schema.sql
└── frontend/
    ├── app/                 layout, page, login/, dashboard/, globals.css
    ├── components/          Navbar.js, AssistantWidget.js
    └── lib/                 api.js, supabaseClient.js
```
