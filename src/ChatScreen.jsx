import React, { useEffect, useRef, useState } from "react";
import "./ChatScreen.css"; // <-- include the plain CSS file with the classes used below
import { useLocation } from "react-router-dom";

export default function ChatScreen() {
  const { state } = useLocation();
  const { chatSessionId, lang = "Spanish", level } = state || {};
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: "bot",
      text: `You are now practicing ${lang}! Say something 👋`,
      elo: 1600,
      delta: 0,
      ts: ts(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [userElo, setUserElo] = useState(1600);
  const [botElo, setBotElo] = useState(1600);
  const [eloChange, setEloChange] = useState();
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    console.log(chatSessionId);
  }, [messages.length]);

  // --- POST helper
// --- POST helper (fixed) ---
async function postToWebhook(url, payload, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),   // <-- USE the payload you passed in
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    throw new Error(e.name === "AbortError" ? "Request timed out" : e.message || "Network error");
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}${txt ? ` – ${txt}` : ""}`);
  }

  // Try JSON first, fall back to text
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return res.json();
  }
  return res.text();
}

  const [menuOpen, setMenuOpen] = useState(false);
const menuRef = useRef(null);

useEffect(() => {
  const onClickOutside = (e) => {
    if (menuRef.current && !menuRef.current.contains(e.target)) {
      setMenuOpen(false);
    }
  };
  document.addEventListener("mousedown", onClickOutside);
  return () => document.removeEventListener("mousedown", onClickOutside);
}, []);

function onProfile() {
  // TODO: open profile modal / navigate
  console.log("Profile clicked");
  setMenuOpen(false);
}

function onLogout() {
  // TODO: clear auth state, redirect, etc.
  console.log("Logout clicked");
  setMenuOpen(false);
}

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isSending) return;

    // append user message + ELO
    const userDelta = randDelta();
    const newUserElo = userElo + userDelta;
    setUserElo(newUserElo);
    const userMsg = {
      id: Date.now(),
      role: "user",
      text: trimmed,
      elo: newUserElo,
      delta: userDelta,
      ts: ts(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    // webhook → agent reply
    setIsSending(true);
    try {
      const data = await postToWebhook(
        "https://mattwalter2.app.n8n.cloud/webhook-test/b72ad15a-4be2-4888-af94-4c80814eddd3",
        {
          message: trimmed,
          lang,
          userElo: newUserElo,
          botElo,
          history: messages.slice(-10).map(({ role, text }) => ({ role, text })),
          chatSessionId,
        }
      );

      // Extract the agent's reply (supports string or { text_response } or { reply })
      const botText =
        (typeof data === "string" ? data : (data?.text_response ?? data?.reply))?.toString().trim() ||
        "(no reply)";

      setEloChange(data?.rating_change);

      const botMsg = {
        id: Date.now() + 1,
        role: "bot",
        text: botText,
        elo: newBotElo,
        delta: botDelta,
        ts: ts(),
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch (err) {
      const botMsg = {
        id: Date.now() + 2,
        role: "bot",
        text: `Webhook error: ${err.message}`,
        elo: botElo,
        delta: 0,
        ts: ts(),
      };
      setMessages((prev) => [...prev, botMsg]);
    } finally {
      setIsSending(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-container">
      <div className="chat-header">
  <div className="logo">AI</div>
  <div>
    <div className="title">Converso</div>
    <div className="subtitle">Practicing: {lang}</div>
    {eloChange !== undefined && (
      <div className={`elo-change ${eloChange > 0 ? "positive" : eloChange < 0 ? "negative" : ""}`}>
        {eloChange > 0 ? `+${eloChange}` : eloChange}
      </div>
    )}
  </div>
</div>
      <div className="header-actions" ref={menuRef}>


    {/* Gear button */}
    <button
      className="gear-btn"
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      aria-label="Settings"
      onClick={() => setMenuOpen((v) => !v)}
    >
      <svg className="gear-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M19.14,12.94a7.15,7.15,0,0,0,.05-.94,7.15,7.15,0,0,0-.05-.94l2.11-1.65a.48.48,0,0,0,.11-.61l-2-3.46a.5.5,0,0,0-.6-.22l-2.49,1a7.3,7.3,0,0,0-1.63-.94l-.38-2.65A.49.49,0,0,0,13.72,2H10.28a.49.49,0,0,0-.49.41L9.41,5.06a7.3,7.3,0,0,0-1.63.94l-2.49-1a.5.5,0,0,0-.6.22l-2,3.46a.48.48,0,0,0,.11.61L4.91,11.06a7.15,7.15,0,0,0-.05.94,7.15,7.15,0,0,0,.05.94L2.8,14.59a.48.48,0,0,0-.11.61l2,3.46a.5.5,0,0,0,.6.22l2.49-1a7.3,7.3,0,0,0,1.63.94l.38,2.65a.49.49,0,0,0,.49.41h3.44a.49.49,0,0,0,.49-.41l.38-2.65a7.3,7.3,0,0,0,1.63-.94l2.49,1a.5.5,0,0,0,.6-.22l2-3.46a.48.48,0,0,0-.11-.61ZM12,15.5A3.5,3.5,0,1,1,15.5,12,3.5,3.5,0,0,1,12,15.5Z"/>
      </svg>
    </button>

    {/* Dropdown */}
    {menuOpen && (
      <div className="dropdown" role="menu">
        <div className="item" role="menuitem" onClick={onProfile}>
          <svg className="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5Z"/>
          </svg>
          Profile
        </div>
        <div className="section-title">Account</div>
        <div className="item" role="menuitem" onClick={onLogout}>
          <svg className="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M10 17v-2h4v-6h-4V7l-5 5 5 5Zm9 3H12v-2h7V6H12V4h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2Z"/>
          </svg>
          Log out
        </div>
      </div>
    )}
  </div>
      
      <div className="chat-box">
        {/* Header */}
        <div className="chat-header">
          <div className="logo">AI</div>
          <div>
            <div className="title">Converso</div>
            <div className="subtitle">Practicing: {lang}</div>
          </div>
         
        </div>

        {/* Messages */}
        <div className="chat-messages" ref={listRef}>
          {messages.map((m) => {
            const isUser = m.role === "user";
            return (
              <div className={`message-row ${isUser ? "right" : "left"}`} key={m.id}>
                {!isUser && <div className="avatar bot">AI</div>}
                <div className={`bubble ${isUser ? "user" : "bot"}`}>
                  <div className="meta">
                    <span className="chip">ELO {m.elo ?? "—"}</span>
                    <span className={`chip delta ${m.delta > 0 ? "up" : m.delta < 0 ? "down" : ""}`}>
                      {m.delta === 0 ? "±0" : m.delta > 0 ? `+${m.delta}` : m.delta}
                    </span>
                    <span className="time">{m.ts}</span>
                  </div>
                  <span className="text">{m.text}</span>
                </div>
                {isUser && <div className="avatar user">You</div>}
              </div>
            );
          })}
          {isSending && (
            <div className="message-row left">
              <div className="avatar bot">AI</div>
              <div className="bubble bot">
                <div className="meta">
                  <span className="chip">ELO {botElo}</span>
                  <span className="chip delta">…</span>
                  <span className="time">{ts()}</span>
                </div>
                Typing…
              </div>
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="composer">
          <div className="composer-inner">
            <textarea
              placeholder={`Type your message in ${lang}…`}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button onClick={handleSend} disabled={!input.trim() || isSending}>
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */
function randDelta() {
  const n = Math.floor(Math.random() * 31); // 0..30
  const sign = Math.random() < 0.5 ? -1 : 1;
  return sign * (n || 1); // avoid 0
}
function ts() {
  const d = new Date();
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}