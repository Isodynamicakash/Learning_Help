"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import { api } from "../../lib/api";
import Navbar from "../../components/Navbar";

const TYPE_LABEL = { course: "Course", project: "Project", resource: "Resource" };
const STATUS_LABEL = { not_started: "Not started", in_progress: "In progress", completed: "Completed" };

export default function Dashboard() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [email, setEmail] = useState("");
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
      alert("Couldn't generate a path yet — chat with the assistant about your goal first.");
    }
    setLoading(false);
  }

  async function explainStep(course_id) {
    const res = await api.explain(userId, course_id);
    setExplanations((e) => ({ ...e, [course_id]: res.explanation }));
  }

  async function markDone(course_id) {
    await api.updateProgress(userId, course_id, "completed");
    await refreshAll(userId);
  }

  async function giveFeedback(course_id, feedback) {
    if (!pathId) return alert("No active path to adapt.");
    setAdapting(course_id);
    try {
      await api.updateProgress(userId, course_id, "in_progress", feedback);
      await api.adaptPath(userId, pathId, course_id, feedback);
      await refreshAll(userId);
    } catch (e) {
      alert("Couldn't adapt the path — is the backend running?");
    }
    setAdapting(null);
  }

  const pct = progress.total ? Math.round((progress.completed / progress.total) * 100) : 0;
  const initial = (email || "?").charAt(0).toUpperCase();

  return (
    <>
      <Navbar email={email} />
      <div className="container">
        <h1 className="page-title">Dashboard</h1>

        {profile && (
          <div className="card profile-card">
            <div className="profile-avatar">{initial}</div>
            <div style={{ flex: 1 }}>
              <p className="card-title" style={{ marginBottom: 2 }}>{email}</p>
              {profile.goal && <p style={{ margin: "4px 0", fontSize: 14 }}><strong>Goal:</strong> {profile.goal}</p>}
              <div style={{ marginTop: 8 }}>
                {profile.skill_level && <span className="tag">{profile.skill_level}</span>}
                {(profile.interests || []).map((i) => <span className="tag" key={i}>{i}</span>)}
                {(profile.known_topics || []).map((k) => <span className="tag" key={k}>{k}</span>)}
              </div>
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-header">
            <p className="card-title" style={{ margin: 0 }}>Progress</p>
            <span style={{ fontSize: 13, color: "var(--text-dim)" }}>{progress.completed}/{progress.total} ({pct}%)</span>
          </div>
          <div className="progress-bar" style={{ marginTop: 10 }}>
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {progress.skill_gaps && progress.skill_gaps.length > 0 && (
          <div className="card">
            <p className="card-title">Skill gaps toward your goal</p>
            <p className="card-sub" style={{ marginBottom: 10 }}>Topics your goal needs that you haven't covered yet</p>
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
            {skills.skills.map((s) => (
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

        <button className="btn-primary btn-block" onClick={generate} disabled={loading}>
          {loading ? "Generating..." : progress.items.length ? "Regenerate my learning path" : "Generate my learning path"}
        </button>

        <div style={{ marginTop: 20 }}>
          {progress.items.length === 0 && (
            <div className="empty-state">
              <div className="big-emoji">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                  <path d="M9 20l-5.447-2.724A1 1 0 0 1 3 16.382V5.618a1 1 0 0 1 1.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0 0 21 18.382V7.618a1 1 0 0 0-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
              </div>
              <p>No path yet — generate one above once you've chatted about your goal.</p>
            </div>
          )}
          {progress.items.map((s) => (
            <div className={`card step-card type-${s.item_type || "course"}`} key={s.course_id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <strong style={{ fontSize: 14.5 }}>{s.order}. <span style={{ color: "var(--text-dim)", fontWeight: 500, fontSize: 12.5, textTransform: "uppercase", letterSpacing: "0.03em" }}>{TYPE_LABEL[s.item_type] || "Course"}</span> · {s.title}</strong>
                <span className={`pill pill-${s.status || "not_started"}`}>{STATUS_LABEL[s.status] || s.status}</span>
              </div>
              {s.reason && <p style={{ opacity: 0.85, fontSize: 14, marginTop: 8 }}>{s.reason}</p>}
              {s.milestone && <p style={{ fontSize: 13, marginTop: 4, color: "var(--text-dim)" }}>Milestone: {s.milestone}</p>}
              {s.feedback && <p style={{ fontSize: 12, opacity: 0.55, marginTop: 4 }}>Feedback given: {s.feedback}</p>}
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
                      {adapting === s.course_id ? "Adapting..." : "Struggled — adjust path"}
                    </button>
                    <button
                      className="btn-ghost btn-sm"
                      disabled={adapting === s.course_id}
                      onClick={() => giveFeedback(s.course_id, "too_easy")}
                    >
                      Too easy — skip ahead
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
            }
