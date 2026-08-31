"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import { api } from "../../lib/api";
import Navbar from "../../components/Navbar";

const TYPE_ORDER = ["course", "project", "resource"];
const TYPE_SECTION_LABEL = { course: "Courses", project: "Projects", resource: "Resources" };
const STATUS_LABEL = { not_started: "Not started", in_progress: "In progress", completed: "Completed" };
const CONFETTI_COLORS = ["#5b7fdb", "#3fb27f", "#c98a2c", "#d4574f", "#8b93a1"];

function Confetti() {
  const pieces = Array.from({ length: 70 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.5,
    duration: 1.8 + Math.random() * 1.2,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    round: Math.random() > 0.65,
  }));
  return (
    <div className="confetti-layer">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            borderRadius: p.round ? "50%" : "2px",
          }}
        />
      ))}
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [pathId, setPathId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [progress, setProgress] = useState({ items: [], total: 0, completed: 0, skill_gaps: [], streak: 0 });
  const [skills, setSkills] = useState({ skills: [], completed_count: 0 });
  const [explanations, setExplanations] = useState({});
  const [loading, setLoading] = useState(false);
  const [adapting, setAdapting] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(null); // { title, sub }
  const [celebration, setCelebration] = useState(null); // { title, sub }
  const [viewMode, setViewMode] = useState("order"); // "order" | "type"

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

  useEffect(() => {
    function onPathChanged() {
      if (userId) refreshAll(userId);
    }
    window.addEventListener("pathwise:path-changed", onPathChanged);
    return () => window.removeEventListener("pathwise:path-changed", onPathChanged);
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!celebration) return;
    const t = setTimeout(() => setCelebration(null), 4200);
    return () => clearTimeout(t);
  }, [celebration]);

  async function refreshAll(uid) {
    setRefreshing(true);
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
    setRefreshing(false);
  }

  async function generate() {
    setLoading(true);
    setBusy({ title: "Building your path", sub: "Matching courses to your goal and skill level" });
    try {
      await api.generatePath(userId);
      await refreshAll(userId);
    } catch (e) {
      alert(`Couldn't generate a path: ${e.message}`);
    }
    setBusy(null);
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

  async function markDone(course_id, title) {
    try {
      await api.updateProgress(userId, course_id, "completed");
      const before = progress.completed;
      const total = progress.total;
      await refreshAll(userId);
      const remaining = Math.max(0, total - (before + 1));
      const goalText = profile?.goal ? `your ${profile.goal} goal` : "your goal";
      window.dispatchEvent(
        new CustomEvent("pathwise:step-completed", {
          detail: { title, completed: before + 1, total, streak: progress.streak },
        })
      );
      setCelebration(
        remaining === 0
          ? { title: "Path complete!", sub: `You finished every step toward ${goalText}.` }
          : {
              title: "Hurray — step complete!",
              sub: `${title} done. ${remaining} step${remaining === 1 ? "" : "s"} left to ${goalText}.`,
            }
      );
    } catch (e) {
      alert(`Couldn't update progress: ${e.message}`);
    }
  }

  async function giveFeedback(course_id, feedback) {
    if (!pathId) return alert("No active path to adapt.");
    setAdapting(course_id);
    setBusy({
      title: "Adapting your path",
      sub: feedback === "struggled"
        ? "Adding foundations before you continue"
        : "Skipping ahead to something more challenging",
    });
    try {
      await api.updateProgress(userId, course_id, "in_progress", feedback);
      await api.adaptPath(userId, pathId, course_id, feedback);
      await refreshAll(userId);
    } catch (e) {
      alert(`Couldn't adapt the path: ${e.message}`);
    }
    setBusy(null);
    setAdapting(null);
  }

  const pct = progress.total ? Math.round((progress.completed / progress.total) * 100) : 0;
  const initial = (name || email || "?").charAt(0).toUpperCase();
  const nextUp = progress.items.find((i) => i.status !== "completed") || null;

  const grouped = {};
  for (const item of progress.items) {
    const t = item.item_type || "course";
    if (!grouped[t]) grouped[t] = [];
    grouped[t].push(item);
  }

  function renderStepCard(s) {
    return (
      <div
        className={`card step-card type-${s.item_type || "course"} ${s.status === "completed" ? "is-done" : ""}`}
        key={s.course_id}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="step-order-badge">{s.order}</span>
            <div>
              <span className="type-chip">{TYPE_SECTION_LABEL[s.item_type] || "Course"}</span>
              <strong style={{ fontSize: 14.5, display: "block", marginTop: 2 }}>{s.title}</strong>
            </div>
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
          <button
            className="btn-secondary btn-sm"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("pathwise:open-assistant", {
                  detail: { courseId: s.course_id, title: s.title },
                })
              )
            }
          >
            Ask more
          </button>
          {s.status !== "completed" && (
            <>
              <button className="btn-secondary btn-sm" onClick={() => markDone(s.course_id, s.title)}>Mark complete</button>
              <button
                className="btn-ghost btn-sm"
                disabled={adapting === s.course_id}
                onClick={() => giveFeedback(s.course_id, "struggled")}
              >
                Struggled
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
      {busy && (
        <div className="busy-overlay">
          <div className="busy-card">
            <div className="spinner" />
            <p className="busy-title">{busy.title}</p>
            <p className="busy-sub">{busy.sub}</p>
            <div className="busy-dots"><span /><span /><span /></div>
          </div>
        </div>
      )}

      {celebration && (
        <>
          <Confetti />
          <div className="celebrate-toast">
            <p className="celebrate-title">{celebration.title}</p>
            <p className="celebrate-sub">{celebration.sub}</p>
          </div>
        </>
      )}

      <Navbar email={email} name={name} />
      <div className="dash-wrap">
        <div className="dash-header">
          <div>
            <h1 className="page-title" style={{ margin: 0 }}>Dashboard</h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-dim)" }}>
              {progress.items.length ? "Your current learning path" : "No path generated yet"}
            </p>
          </div>
          <button className="btn-primary" onClick={generate} disabled={loading}>
            {loading ? "Generating..." : progress.items.length ? "Regenerate path" : "Generate my learning path"}
          </button>
        </div>

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
                <div style={{ marginTop: 10 }}>
                  {profile.skill_level && <span className="tag">{profile.skill_level}</span>}
                  {(profile.interests || []).map((i) => <span className="tag" key={i}>{i}</span>)}
                  {(profile.known_topics || []).map((k) => <span className="tag" key={k}>{k}</span>)}
                </div>
                <div style={{ display: "flex", gap: 16, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                  <div>
                    <p style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{skills.completed_count}</p>
                    <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)" }}>Completed all-time</p>
                  </div>
                  <div>
                    <p style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{progress.total}</p>
                    <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)" }}>In current path</p>
                  </div>
                </div>
                {profile.updated_at && (
                  <p style={{ margin: "10px 0 0", fontSize: 10.5, color: "var(--text-dim)" }}>
                    Profile updated {new Date(profile.updated_at).toLocaleString()}
                  </p>
                )}
              </div>
            )}

            {/* ---- Goal card ---- */}
            <div className="card goal-card">
              <p className="card-sub" style={{ margin: 0 }}>Your goal</p>
              <p className="goal-title">
                {profile?.goal || "Not set yet — tell the assistant in chat"}
              </p>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="goal-meta">
                <span>{progress.completed} of {progress.total} steps</span>
                <span>{pct}%</span>
              </div>
            </div>

            {/* ---- Streak card ---- */}
            <div className="card streak-card">
              <div className="streak-flame">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2s4 4.5 4 8a4 4 0 0 1-8 0c0-1 .5-2 .5-2S6 10 6 14a6 6 0 0 0 12 0c0-5-6-12-6-12z" />
                </svg>
              </div>
              <div>
                <p className="streak-num">{progress.streak || 0}</p>
                <p className="streak-label">
                  {progress.streak === 1 ? "day streak" : "day streak"}
                  {!progress.streak && " — complete a step today"}
                </p>
              </div>
            </div>

          </div>

          {/* ---------- Main content ---------- */}
          <div>
            {!profile?.goal && (
              <div className="banner" style={{ marginBottom: 16 }}>
                <span>No goal set yet — tell the assistant what you want to learn.</span>
                <button
                  className="btn-primary btn-sm"
                  onClick={() => window.dispatchEvent(new CustomEvent("pathwise:open-assistant"))}
                >
                  Open assistant
                </button>
              </div>
            )}

            {progress.items.length === 0 && (
              <div className="card empty-state">
                <div className="big-emoji">
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                    <path d="M9 20l-5.447-2.724A1 1 0 0 1 3 16.382V5.618a1 1 0 0 1 1.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0 0 21 18.382V7.618a1 1 0 0 0-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                </div>
                <p>Tell the assistant your goal, then generate a path here.</p>
              </div>
            )}

            {progress.items.length > 0 && (
              <div className="view-toggle">
                <button
                  className={viewMode === "order" ? "active" : ""}
                  onClick={() => setViewMode("order")}
                >
                  In order
                </button>
                <button
                  className={viewMode === "type" ? "active" : ""}
                  onClick={() => setViewMode("type")}
                >
                  By type
                </button>
              </div>
            )}

            {viewMode === "order" ? (
              <div className="steps-grid">
                {progress.items.map(renderStepCard)}
              </div>
            ) : (
              TYPE_ORDER.filter((t) => grouped[t]?.length).map((t) => (
                <div key={t}>
                  <div className="section-heading">
                    {TYPE_SECTION_LABEL[t]}
                    <span className="count">{grouped[t].length}</span>
                  </div>
                  <div className="steps-grid">
                    {grouped[t].map(renderStepCard)}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* ---------- Right sidebar ---------- */}
          <div className="right-col">
            {nextUp && (
              <div className="card">
                <p className="card-title">Next up</p>
                <p className="card-sub" style={{ marginBottom: 8 }}>Your next recommended action</p>
                <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>
                  {nextUp.order}. {nextUp.title}
                </p>
                {nextUp.milestone && (
                  <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-dim)" }}>
                    Milestone: {nextUp.milestone}
                  </p>
                )}
              </div>
            )}

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
                {skills.skills.slice(0, 10).map((s) => (
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

            <div className="card">
              <p className="card-title">Path breakdown</p>
              <p className="card-sub" style={{ marginBottom: 12 }}>What's in your current plan</p>
              {TYPE_ORDER.map((t) => {
                const list = grouped[t] || [];
                const done = list.filter((i) => i.status === "completed").length;
                if (!list.length) return null;
                return (
                  <div className="skill-row" key={t}>
                    <div className="skill-row-top">
                      <span>{TYPE_SECTION_LABEL[t]}</span>
                      <span style={{ opacity: 0.6 }}>{done}/{list.length}</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${list.length ? (done / list.length) * 100 : 0}%` }} />
                    </div>
                  </div>
                );
              })}
              {progress.items.length === 0 && (
                <p className="card-sub" style={{ margin: 0 }}>No path yet.</p>
              )}
            </div>

            {skills.skills.length === 0 && progress.items.length > 0 && (
              <div className="card">
                <p className="card-title">Skill development</p>
                <p className="card-sub" style={{ margin: 0 }}>
                  Complete a step to start building your skill profile.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
