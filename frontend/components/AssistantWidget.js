"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

/**
 * Floating assistant. Always answers from the learner's live state (the
 * backend reloads profile + path + progress on every message), and can
 * request actions — currently regenerating the path, which this component
 * performs and then reports back via onPathChanged().
 */
export default function AssistantWidget({ userId, openSignal, seedContext, onPathChanged }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Ask me anything about your path or progress." },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [contextCourseId, setContextCourseId] = useState(null);
  const endRef = useRef(null);

  // Opened from elsewhere (e.g. "Ask more" on a step card)
  useEffect(() => {
    if (!openSignal) return;
    setOpen(true);
    if (seedContext?.courseId) {
      setContextCourseId(seedContext.courseId);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `Ask me anything about "${seedContext.title}".`,
        },
      ]);
    }
  }, [openSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  async function send(text) {
    const msg = (text ?? input).trim();
    if (!msg || !userId) return;
    setMessages((m) => [...m, { role: "user", content: msg }]);
    setInput("");
    setSending(true);
    try {
      const res = await api.assistant(userId, msg, contextCourseId);
      setMessages((m) => [...m, { role: "assistant", content: res.reply }]);

      if (res.action === "regenerate_path") {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: "Rebuilding your path now…" },
        ]);
        try {
          await api.generatePath(userId);
          onPathChanged?.();
          setMessages((m) => [
            ...m,
            { role: "assistant", content: "Done — your new path is on the dashboard." },
          ]);
        } catch (e) {
          setMessages((m) => [
            ...m,
            { role: "assistant", content: `Couldn't rebuild it: ${e.message}` },
          ]);
        }
      }
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Something went wrong: ${e.message}` },
      ]);
    }
    setSending(false);
  }

  const quickActions = [
    "What should I do next?",
    "How am I doing?",
    "Rebuild my path",
  ];

  return (
    <>
      {open && (
        <div className="assistant-panel">
          <div className="assistant-head">
            <div>
              <p className="assistant-title">Assistant</p>
              <p className="assistant-sub">Knows your path and progress</p>
            </div>
            <button className="assistant-close" onClick={() => setOpen(false)} aria-label="Close">
              ✕
            </button>
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
              <button key={q} className="quick-chip" disabled={sending} onClick={() => send(q)}>
                {q}
              </button>
            ))}
          </div>

          <div className="assistant-input">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Ask about your path…"
            />
            <button className="btn-primary btn-sm" onClick={() => send()} disabled={sending}>
              Send
            </button>
          </div>
        </div>
      )}

      <button
        className="assistant-fab"
        onClick={() => setOpen((o) => !o)}
        aria-label="Open assistant"
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        )}
      </button>
    </>
  );
}
