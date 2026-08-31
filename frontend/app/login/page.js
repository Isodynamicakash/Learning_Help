"use client";
import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";

export default function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function sendLink(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithOtp({ email });
    setLoading(false);
    if (!error) setSent(true);
    else setError(error.message);
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 380, padding: 20 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10, background: "var(--accent)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 14px",
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" />
              <path d="M18.4 8.6a4 4 0 1 1-5.8 5.5" />
              <path d="M7 15l4-4 3 3 5-5" />
            </svg>
          </div>
          <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: "-0.01em" }}>Pathwise</h1>
          <p style={{ color: "var(--text-dim)", fontSize: 13.5, marginTop: 6 }}>
            Your personalized learning path, built around your goals.
          </p>
        </div>

        <div className="card">
          {sent ? (
            <div style={{ textAlign: "center", padding: "6px 0" }}>
              <div style={{
                width: 40, height: 40, borderRadius: "50%", background: "var(--accent-soft)",
                display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px",
              }}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="m3 7 9 6 9-6" />
                </svg>
              </div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 14.5 }}>Check your email</p>
              <p style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
                We sent a sign-in link to<br /><strong style={{ color: "var(--text)" }}>{email}</strong>
              </p>
            </div>
          ) : (
            <form onSubmit={sendLink}>
              <p style={{ margin: "0 0 14px", fontSize: 13.5, color: "var(--text-dim)" }}>
                Sign in with your email to get started.
              </p>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{ marginBottom: 12 }}
              />
              {error && <p style={{ color: "var(--danger)", fontSize: 12.5, marginBottom: 10 }}>{error}</p>}
              <button className="btn-primary btn-block" disabled={loading}>
                {loading ? "Sending..." : "Send sign-in link"}
              </button>
            </form>
          )}
        </div>
        <p style={{ opacity: 0.5, fontSize: 12, textAlign: "center", marginTop: 14 }}>
          Requires Email auth enabled in your Supabase project.
        </p>
      </div>
    </div>
  );
}
