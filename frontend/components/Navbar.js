"use client";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

export default function Navbar({ email }) {
  const router = useRouter();
  const pathname = usePathname();

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const initial = (email || "?").charAt(0).toUpperCase();

  return (
    <div className="navbar">
      <div className="navbar-brand">
        <span className="navbar-logo">🧭</span>
        Pathwise
      </div>
      <div className="navbar-links">
        <a href="/chat" className={`nav-link ${pathname === "/chat" ? "active" : ""}`}>Chat</a>
        <a href="/dashboard" className={`nav-link ${pathname === "/dashboard" ? "active" : ""}`}>Dashboard</a>
        <span className="avatar" title={email}>{initial}</span>
        <button className="btn-danger btn-sm" onClick={logout}>Log out</button>
      </div>
    </div>
  );
}