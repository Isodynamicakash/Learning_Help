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
        <span className="navbar-logo">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18" />
            <path d="M18.4 8.6a4 4 0 1 1-5.8 5.5" />
            <path d="M7 15l4-4 3 3 5-5" />
          </svg>
        </span>
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
