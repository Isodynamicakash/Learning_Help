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
      <div style={{ width: "100%", maxWidth: 400, padding: 20 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🧭</div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Pathwise</h1>
          <p style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 6 }}>
            Your personalized learning path, built around your goals.
          </p>
        </div>

        <div className="card">
          {sent ? (
            <div style={{ textAlign: "center", padding: "10px 0" }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>📩</div>
              <p style={{ margin: 0, fontWeight: 600 }}>Check your email</p>
              <p style={{ color: "var(--text-dim)", fontSize: 13.5, marginTop: 6 }}>
                We sent a magic sign-in link to <strong>{email}</strong>.
              </p>
            </div>
          ) : (
            <form onSubmit={sendLink}>
              <p style={{ margin: "0 0 14px", fontSize: 14, color: "var(--text-dim)" }}>
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
              {error && <p style={{ color: "var(--danger)", fontSize: 13, marginBottom: 10 }}>{error}</p>}
              <button className="btn-primary btn-block" disabled={loading}>
                {loading ? "Sending..." : "Send magic link"}
              </button>
            </form>
          )}
        </div>
        <p style={{ opacity: 0.5, fontSize: 12.5, textAlign: "center", marginTop: 14 }}>
          Requires Email auth enabled in your Supabase project.
        </p>
      </div>
    </div>
  );
}