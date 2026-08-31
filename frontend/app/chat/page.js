"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import { api } from "../../lib/api";
import Navbar from "../../components/Navbar";

export default function Chat() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hi! Tell me what you're trying to learn or what goal you're working toward — I'll build a path around it." },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [profile, setProfile] = useState(null);
  const [profileChanged, setProfileChanged] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/login");
      else {
        setUserId(data.session.user.id);
        setEmail(data.session.user.email);
        setName(data.session.user.user_metadata?.full_name || "");
        loadProfile(data.session.user.id);
      }
    });
  }, [router]);

  async function loadProfile(uid) {
    try {
      const prof = await api.getChatProfile(uid);
      if (prof && Object.keys(prof).length) setProfile(prof);
    } catch (e) {}
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!input.trim() || !userId) return;
    const userMsg = input;
    setMessages((m) => [...m, { role: "user", content: userMsg }]);
    setInput("");
    setSending(true);
    try {
      const res = await api.chat(userId, userMsg);
      setMessages((m) => [...m, { role: "assistant", content: res.reply }]);
      if (res.profile_updated) {
        setProfile(res.profile);
        setProfileChanged(true);
      }
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: "Something went wrong — is the backend running?" }]);
    }
    setSending(false);
  }

  const initial = (name || email || "?").charAt(0).toUpperCase();

  return (
    <>
      <Navbar email={email} name={name} />
      <div className="chat-wrap">
        <div className="dash-header">
          <h1 className="page-title" style={{ margin: 0 }}>Chat</h1>
        </div>

        <div className="chat-grid">
          {/* ---------- Sidebar ---------- */}
          <div className="sidebar-col">
            <div className="card">
              <div className="profile-card">
                <div className="profile-avatar">{initial}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="card-title" style={{ marginBottom: 2 }}>{name || email}</p>
                  {name && <p className="card-sub" style={{ marginBottom: 0 }}>{email}</p>}
                </div>
              </div>
              {profile && (profile.goal || profile.skill_level || (profile.interests || []).length > 0) ? (
                <>
                  {profile.goal && <p style={{ margin: "10px 0 0", fontSize: 13.5 }}><strong>Goal:</strong> {profile.goal}</p>}
                  <div style={{ marginTop: 8 }}>
                    {profile.skill_level && <span className="tag">{profile.skill_level}</span>}
                    {(profile.interests || []).map((i) => <span className="tag" key={i}>{i}</span>)}
                    {(profile.known_topics || []).map((k) => <span className="tag" key={k}>{k}</span>)}
                  </div>
                </>
              ) : (
                <p className="card-sub" style={{ marginTop: 10, marginBottom: 0 }}>
                  No profile yet — tell the assistant your goal to get started.
                </p>
              )}
            </div>

            <div className="card">
              <p className="card-title">Tips</p>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13, color: "var(--text-dim)", lineHeight: 1.7 }}>
                <li>Mention your current skill level and anything you already know</li>
                <li>Be specific about your goal (e.g. "backend developer" not just "programming")</li>
                <li>After your profile updates, head to the Dashboard to generate your path</li>
              </ul>
            </div>

            <a href="/dashboard" className="btn-primary btn-block" style={{ display: "block", textAlign: "center", textDecoration: "none" }}>
              Go to Dashboard →
            </a>
          </div>

          {/* ---------- Main chat ---------- */}
          <div>
            {profileChanged && (
              <div className="banner">
                <span>Your profile just updated — regenerate your path to reflect it.</span>
                <a href="/dashboard">Go to Dashboard →</a>
              </div>
            )}

            <div className="card">
              <div className="chat-window">
                {messages.map((m, i) => (
                  <div key={i} className={`msg-row ${m.role === "user" ? "user" : ""}`}>
                    <div className={`bubble ${m.role === "user" ? "bubble-user" : "bubble-assistant"}`}>
                      {m.content}
                    </div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>

              <div className="chat-input-row">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                  placeholder="e.g. I want to become a backend developer, I know basic Python"
                />
                <button className="btn-primary" onClick={send} disabled={sending}>
                  {sending ? "..." : "Send"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
