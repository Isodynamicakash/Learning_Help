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
      }
    });
  }, [router]);

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
      setMessages((m) => [...m, { role: "assistant", content: "Something went wrong — is the backend running on :8000?" }]);
    }
    setSending(false);
  }

  return (
    <>
      <Navbar email={email} />
      <div className="container">
        <h1 className="page-title">Chat</h1>

        {profile && (profile.goal || profile.skill_level || (profile.interests || []).length > 0) && (
          <div className="card">
            <p className="card-sub" style={{ marginBottom: 8 }}>Profile so far</p>
            {profile.goal && <span className="tag">Goal: {profile.goal}</span>}
            {profile.skill_level && <span className="tag">{profile.skill_level}</span>}
            {(profile.interests || []).map((i) => (
              <span className="tag" key={i}>{i}</span>
            ))}
          </div>
        )}

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

        <div style={{ textAlign: "center" }}>
          <a href="/dashboard">Go to your dashboard →</a>
        </div>
      </div>
    </>
  );
}
