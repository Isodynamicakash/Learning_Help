"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "../lib/supabaseClient";
import { api } from "../lib/api";

const FAB_SIZE = 68;
const EDGE = 24;

/**
 * Global floating assistant.
 * - Self-contained: gets its own session, so it can be mounted app-wide.
 * - Draggable: press and drag the button anywhere on screen.
 * - Proactive: greets with real progress on first open, and reacts when a
 *   step is completed (dashboard dispatches "pathwise:step-completed").
 * - Can trigger actions the backend requests (regenerate path).
 */
const HIDDEN_ON = ["/login", "/"];

export default function AssistantWidget() {
  const pathname = usePathname();
  const [userId, setUserId] = useState(null);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [contextCourseId, setContextCourseId] = useState(null);
  const [unread, setUnread] = useState(0);
  const [greeted, setGreeted] = useState(false);

  // position stored as distance from right/bottom
  const [pos, setPos] = useState({ right: EDGE, bottom: EDGE });
  const dragState = useRef({ dragging: false, moved: false, startX: 0, startY: 0, origin: null });
  const endRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    function applyUser(nextId) {
      if (!mounted) return;
      setUserId((prev) => {
        // Different account (or signed out) — wipe the previous person's
        // conversation so nothing leaks between users.
        if (prev !== nextId) {
          setMessages([]);
          setGreeted(false);
          setUnread(0);
          setContextCourseId(null);
          setOpen(false);
        }
        return nextId;
      });
    }

    supabase.auth.getSession().then(({ data }) => {
      applyUser(data.session ? data.session.user.id : null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      applyUser(session ? session.user.id : null);
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  const pushAssistant = useCallback((content) => {
    setMessages((m) => [...m, { role: "assistant", content }]);
    setOpen((isOpen) => {
      if (!isOpen) setUnread((u) => u + 1);
      return isOpen;
    });
  }, []);

  // ---- Proactive: contextual greeting using real progress ----
  const greet = useCallback(async (uid) => {
    try {
      const p = await api.getProgress(uid);
      let msg;
      let prof = null;
      try {
        prof = await api.getChatProfile(uid);
      } catch (err) {}
      const hasGoal = prof && prof.goal;

      if (!hasGoal) {
        msg = "Hi! What are you trying to learn, or what role are you aiming for? Tell me your level too and I'll build you a path.";
      } else if (!p.total) {
        msg = `Got your goal: ${prof.goal}. Say "build my path" and I'll put one together.`;
      } else if (p.completed === 0) {
        msg = `You've got ${p.total} steps lined up and haven't started yet. Want me to tell you where to begin?`;
      } else if (p.completed === p.total) {
        msg = `You've finished all ${p.total} steps — want a fresh path to keep going?`;
      } else {
        const left = p.total - p.completed;
        const streak = p.streak ? ` You're on a ${p.streak}-day streak.` : "";
        msg = `You're ${p.completed} of ${p.total} through your path — ${left} left.${streak} What do you need?`;
      }
      setMessages((m) => (m.length ? m : [{ role: "assistant", content: msg }]));
    } catch (e) {
      setMessages((m) =>
        m.length ? m : [{ role: "assistant", content: "Ask me anything about your path or progress." }]
      );
    }
  }, []);

  useEffect(() => {
    if (open && userId && !greeted) {
      setGreeted(true);
      greet(userId);
    }
    if (open) setUnread(0);
  }, [open, userId, greeted, greet]);

  // ---- Listen for app-wide events ----
  useEffect(() => {
    function onOpen(e) {
      setOpen(true);
      const detail = e.detail || {};
      if (detail.courseId) {
        setContextCourseId(detail.courseId);
        pushAssistant(`Ask me anything about "${detail.title}".`);
      }
    }
    function onCompleted(e) {
      const { title, completed, total, streak } = e.detail || {};
      const left = Math.max(0, (total || 0) - (completed || 0));
      let msg;
      if (left === 0) {
        msg = `That's the whole path done — every step complete. Serious work. Want a new one?`;
      } else {
        const streakBit = streak > 1 ? ` ${streak}-day streak going.` : "";
        msg = `Nice — "${title}" done. ${left} step${left === 1 ? "" : "s"} to go.${streakBit} Keep it rolling.`;
      }
      pushAssistant(msg);
    }
    window.addEventListener("pathwise:open-assistant", onOpen);
    window.addEventListener("pathwise:step-completed", onCompleted);
    return () => {
      window.removeEventListener("pathwise:open-assistant", onOpen);
      window.removeEventListener("pathwise:step-completed", onCompleted);
    };
  }, [pushAssistant]);

  // ---- Dragging ----
  function onPointerDown(e) {
    dragState.current = {
      dragging: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      origin: { ...pos },
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    const d = dragState.current;
    if (!d.dragging) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) d.moved = true;
    const maxRight = Math.max(0, window.innerWidth - FAB_SIZE);
    const maxBottom = Math.max(0, window.innerHeight - FAB_SIZE);
    setPos({
      right: Math.min(maxRight, Math.max(0, d.origin.right - dx)),
      bottom: Math.min(maxBottom, Math.max(0, d.origin.bottom - dy)),
    });
  }
  function onPointerUp(e) {
    const d = dragState.current;
    d.dragging = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (!d.moved) setOpen((o) => !o);
  }

  async function send(text) {
    const msg = (text ?? input).trim();
    if (!msg || !userId) return;
    setMessages((m) => [...m, { role: "user", content: msg }]);
    setInput("");
    setSending(true);
    try {
      const res = await api.assistant(userId, msg, contextCourseId);
      setMessages((m) => [...m, { role: "assistant", content: res.reply }]);

      // The assistant may have updated the learner profile (goal, level,
      // known topics) — tell the dashboard to re-read it either way.
      window.dispatchEvent(new CustomEvent("pathwise:path-changed"));

      if (res.action === "regenerate_path") {
        setMessages((m) => [...m, { role: "assistant", content: "Rebuilding your path now…" }]);
        try {
          await api.generatePath(userId);
          window.dispatchEvent(new CustomEvent("pathwise:path-changed"));
          setMessages((m) => [
            ...m,
            { role: "assistant", content: "Done — your new path is on the dashboard." },
          ]);
        } catch (err) {
          setMessages((m) => [...m, { role: "assistant", content: `Couldn't rebuild it: ${err.message}` }]);
        }
      }
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: `Something went wrong: ${e.message}` }]);
    }
    setSending(false);
  }

  if (!userId || HIDDEN_ON.includes(pathname)) return null;

  const quickActions = ["What should I do next?", "How am I doing?", "Rebuild my path"];

  // panel sits above the button, clamped to the viewport
  const panelStyle = {
    right: Math.min(Math.max(pos.right, 12), Math.max(12, (typeof window !== "undefined" ? window.innerWidth : 1200) - 390)),
    bottom: pos.bottom + FAB_SIZE + 12,
  };

  return (
    <>
      {open && (
        <div className="assistant-panel" style={panelStyle}>
          <div className="assistant-head">
            <div>
              <p className="assistant-title">Assistant</p>
              <p className="assistant-sub">Knows your path and progress</p>
            </div>
            <button className="assistant-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
          </div>

          <div className="assistant-body">
            {messages.map((m, i) => (
              <div key={i} className={`msg-row ${m.role === "user" ? "user" : ""}`}>
                <div className={`bubble ${m.role === "user" ? "bubble-user" : "bubble-assistant"}`}>
                  {m.content}
                </div>
              </div>
            ))}
            {sending && (
              <div className="msg-row">
                <div className="bubble bubble-assistant">
                  <span className="typing"><span /><span /><span /></span>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="assistant-quick">
            {quickActions.map((q) => (
              <button key={q} className="quick-chip" disabled={sending} onClick={() => send(q)}>{q}</button>
            ))}
          </div>

          <div className="assistant-input">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Ask about your path…"
            />
            <button className="btn-primary btn-sm" onClick={() => send()} disabled={sending}>Send</button>
          </div>
        </div>
      )}

      <button
        className={`assistant-fab ${open ? "is-open" : ""}`}
        style={{ right: pos.right, bottom: pos.bottom }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        aria-label="Assistant"
        title="Assistant — drag to move"
      >
        {open ? (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        )}
        {!open && unread > 0 && <span className="fab-badge">{unread}</span>}
      </button>
    </>
  );
                           }
