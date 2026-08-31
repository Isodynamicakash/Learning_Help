"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import { api } from "../../lib/api";
import Navbar from "../../components/Navbar";

const TYPE_ORDER = ["course", "project", "resource"];
const TYPE_SECTION_LABEL = { course: "Courses", project: "Projects", resource: "Resources" };
const STATUS_LABEL = { not_started: "Not started", in_progress: "In progress", completed: "Completed" };

export default function Dashboard() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [pathId, setPathId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [progress, setProgress] = useState({ items: [], total: 0, completed: 0, skill_gaps: [] });
  const [skills, setSkills] = useState({ skills: [], completed_count: 0 });
  const [explanations, setExplanations] = useState({});
  const [loading, setLoading] = useState(false);
  const [adapting, setAdapting] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/login");
      else {
        setUserId(data.session.user.id);
        setEmail(data.session.user.email);
        setName(data.session.user.user_metadata?.full_name || "");
        refreshAll(data.session.user.id);
      }
    });
  }, [router]);

  async function refreshAll(uid) {
    try {
      const p = await api.getProgress(uid);
      setProgress(p);
      setPathId(p.path_id);
    } catch (e) {}
    try {
      const s = await api.getSkills(uid);
      setSkills(s);
    } catch (e) {}
    try {
      const prof = await api.getChatProfile(uid);
      setProfile(prof && Object.keys(prof).length ? prof : null);
    } catch (e) {}
  }

  async function generate() {
    setLoading(true);
    try {
      await api.generatePath(userId);
      await refreshAll(userId);
    } catch (e) {
      alert(`Couldn't generate a path: ${e.message}`);
    }
    setLoading(false);
  }

  async function explainStep(course_id) {
    try {
      const res = await api.explain(userId, course_id);
      setExplanations((e) => ({ ...e, [course_id]: res.explanation }));
    } catch (e) {
      alert(`Couldn't get an explanation: ${e.message}`);
    }
  }

  async function markDone(course_id) {
    try {
      await api.updateProgress(userId, course_id, "completed");
      await refreshAll(userId);
    } catch (e) {
      alert(`Couldn't update progress: ${e.message}`);
    }
  }

  async function giveFeedback(course_id, feedback) {
    if (!pathId) return alert("No active path to adapt.");
    setAdapting(course_id);
    try {
      await api.updateProgress(userId, course_id, "in_progress", feedback);
      await api.adaptPath(userId, pathId, course_id, feedback);
      await refreshAll(userId);
    } catch (e) {
      alert(`Couldn't adapt the path: ${e.message}`);
    }
    setAdapting(null);
  }

  const pct = progress.total ? Math.round((progress.completed / progress.total) * 100) : 0;
  const initial = (name || email || "?").charAt(0).toUpperCase();

  const grouped = {};
  for (const item of progress.items) {
    const t = item.item_type || "course";
    if (!grouped[t]) grouped[t] = [];
    grouped[t].push(item);
  }

  function renderStepCard(s) {
    return (
      <div className={`card step-card type-${s.item_type || "course"}`} key={s.course_id}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="step-order-badge">{s.order}</span>
            <strong style={{ fontSize: 14.5 }}>{s.title}</strong>
          </div>
          <span className={`pill pill-${s.status || "not_started"}`}>{STATUS_LABEL[s.status] || s.status}</span>
        </div>
        {s.reason && <p style={{ opacity: 0.85, fontSize: 13.5, marginTop: 8 }}>{s.reason}</p>}
        {s.milestone && <p style={{ fontSize: 12.5, marginTop: 4, color: "var(--text-dim)" }}>Milestone: {s.milestone}</p>}
        {s.feedback && <p style={{ fontSize: 11.5, opacity: 0.55, marginTop: 4 }}>Feedback given: {s.feedback}</p>}
        {explanations[s.course_id] && (
          <div className="explain-box">{explanations[s.course_id]}</div>
        )}
        <div className="step-actions">
          <button className="btn-secondary btn-sm" onClick={() => explainStep(s.course_id)}>Why this?</button>
          {s.status !== "completed" && (
            <>
              <button className="btn-secondary btn-sm" onClick={() => markDone(s.course_id)}>Mark complete</button>
              <button
                className="btn-ghost btn-sm"
                disabled={adapting === s.course_id}
                onClick={() => giveFeedback(s.course_id, "struggled")}
              >
                {adapting === s.course_id ? "Adapting..." : "Struggled"}
              </button>
              <button
                className="btn-ghost btn-sm"
                disabled={adapting === s.course_id}
                onClick={() => giveFeedback(s.course_id, "too_easy")}
              >
                Too easy
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <Navbar email={email} name={name} />
      <div className="dash-wrap">
        <h1 className="page-title">Dashboard</h1>

        <div className="dash-grid">
          {/* ---------- Sidebar ---------- */}
          <div className="sidebar-col">
            {profile && (
              <div className="card">
                <div className="profile-card">
                  <div className="profile-avatar">{initial}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="card-title" style={{ marginBottom: 2 }}>{name || email}</p>
                    {name && <p className="card-sub" style={{ marginBottom: 6 }}>{email}</p>}
                  </div>
                </div>
                {profile.goal && <p style={{ margin: "10px 0 0", fontSize: 13.5 }}><strong>Goal:</strong> {profile.goal}</p>}
                <div style={{ marginTop: 8 }}>
                  {profile.skill_level && <span className="tag">{profile.skill_level}</span>}
                  {(profile.interests || []).map((i) => <span className="tag" key={i}>{i}</span>)}
                  {(profile.known_topics || []).map((k) => <span className="tag" key={k}>{k}</span>)}
                </div>
              </div>
            )}

            <div className="card">
              <div className="card-header">
                <p className="card-title" style={{ margin: 0 }}>Progress</p>
                <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{progress.completed}/{progress.total}</span>
              </div>
              <div className="progress-bar" style={{ marginTop: 10 }}>
                <div className="progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <p style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 6, marginBottom: 0 }}>{pct}% complete</p>
            </div>

            {progress.skill_gaps && progress.skill_gaps.length > 0 && (
              <div className="card">
                <p className="card-title">Skill gaps</p>
                <p className="card-sub" style={{ marginBottom: 10 }}>Not covered yet</p>
                <div>
                  {progress.skill_gaps.map((g) => (
                    <span className="tag tag-gap" key={g}>{g}</span>
                  ))}
                </div>
              </div>
            )}

            {skills.skills.length > 0 && (
              <div className="card">
                <p className="card-title">Skill development</p>
                <p className="card-sub" style={{ marginBottom: 14 }}>{skills.completed_count} item(s) completed</p>
                {skills.skills.slice(0, 8).map((s) => (
                  <div className="skill-row" key={s.tag}>
                    <div className="skill-row-top">
                      <span>{s.tag}</span>
                      <span style={{ opacity: 0.6 }}>{s.strength}</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${Math.min(100, s.strength * 25)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ---------- Main content ---------- */}
          <div>
            <div className="main-col-header">
              <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-dim)" }}>
                {progress.items.length ? "Your current learning path" : "No path generated yet"}
              </p>
              <button className="btn-primary" onClick={generate} disabled={loading}>
                {loading ? "Generating..." : progress.items.length ? "Regenerate path" : "Generate my learning path"}
              </button>
            </div>

            {progress.items.length === 0 && (
              <div className="card empty-state">
                <div className="big-emoji">
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                    <path d="M9 20l-5.447-2.724A1 1 0 0 1 3 16.382V5.618a1 1 0 0 1 1.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0 0 21 18.382V7.618a1 1 0 0 0-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                </div>
                <p>Chat about your goal first, then generate a path here.</p>
              </div>
            )}

            {TYPE_ORDER.filter((t) => grouped[t]?.length).map((t) => (
              <div key={t}>
                <div className="section-heading">
                  {TYPE_SECTION_LABEL[t]}
                  <span className="count">{grouped[t].length}</span>
                </div>
                <div className="steps-grid">
                  {grouped[t].map(renderStepCard)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
                  }
