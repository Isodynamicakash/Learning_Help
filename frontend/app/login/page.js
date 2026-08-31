"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } },
      });
      setLoading(false);
      if (error) {
        setError(error.message);
        return;
      }
      if (data.session) {
        router.replace("/chat");
      } else {
        setNotice("Account created. Check your email once to confirm, then sign in below.");
        setMode("signin");
      }
      return;
    }

    // signin
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.replace("/chat");
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
          <div style={{ display: "flex", gap: 4, marginBottom: 16, background: "var(--surface-2)", padding: 4, borderRadius: 8 }}>
            <button
              type="button"
              className={mode === "signin" ? "btn-primary" : "btn-ghost"}
              style={{ flex: 1, border: "none" }}
              onClick={() => { setMode("signin"); setError(""); setNotice(""); }}
            >
              Sign in
            </button>
            <button
              type="button"
              className={mode === "signup" ? "btn-primary" : "btn-ghost"}
              style={{ flex: 1, border: "none" }}
              onClick={() => { setMode("signup"); setError(""); setNotice(""); }}
            >
              Create account
            </button>
          </div>

          {notice && (
            <p style={{ color: "var(--success)", fontSize: 13, marginBottom: 12 }}>{notice}</p>
          )}

          <form onSubmit={handleSubmit}>
            {mode === "signup" && (
              <input
                type="text"
                placeholder="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                style={{ marginBottom: 10 }}
              />
            )}
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ marginBottom: 10 }}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              style={{ marginBottom: 12 }}
            />
            {error && <p style={{ color: "var(--danger)", fontSize: 12.5, marginBottom: 10 }}>{error}</p>}
            <button className="btn-primary btn-block" disabled={loading}>
              {loading ? "Please wait..." : mode === "signup" ? "Create account" : "Sign in"}
            </button>
          </form>
        </div>
        <p style={{ opacity: 0.5, fontSize: 12, textAlign: "center", marginTop: 14 }}>
          Requires Email auth enabled in your Supabase project.
        </p>
      </div>
    </div>
  );
                     }
