import { Fragment, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "./ChatScreen.css";
import ResultsModal from "./ResultsModal";
import {
  completeSession,
  getProfile,
  getSessionWithMessages,
  reportFromSession,
  sendMessageStream,
  signOut,
  transcribeAudio,
  translateMessage,
  translateWord,
} from "./api";
import { micSupported, startRecording } from "./recorder";
import { ACCENT_KEYS, topicOf } from "./spanish";
import { speak, speechSupported } from "./speech";
import { playTutorMessage, stopTutorAudio } from "./voice";

const AUTOPLAY_KEY = "converso.autoplay";
const MAX_RECORDING_MS = 60_000;
// Words (letters + accents, allowing inner apostrophes/hyphens). Capturing, so split() keeps them at odd indices.
const WORD_SPLIT = /([\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*)/u;

const fmtClock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const without = (obj, key) => {
  const next = { ...obj };
  delete next[key];
  return next;
};

export default function ChatScreen() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);

  const [input, setInput] = useState("");
  const [pending, setPending] = useState(null); // { text, reply }: learner text + Mateo's reply streaming in
  const [sendError, setSendError] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [result, setResult] = useState(null); // report modal: { report, newElo }
  const [finalReport, setFinalReport] = useState(null); // kept after the modal closes

  const [autoplay, setAutoplay] = useState(() => localStorage.getItem(AUTOPLAY_KEY) !== "off");
  const [speakingKey, setSpeakingKey] = useState(null); // `${id}` or `${id}:slow`
  const [menuOpen, setMenuOpen] = useState(false);

  const [gloss, setGloss] = useState(null); // tapped word: { key, word, status, translation?, note?, error? }
  const glossCache = useRef(new Map()); // `${messageId}:${word}` -> { translation, note }
  const [openTranslations, setOpenTranslations] = useState({}); // messageId -> true
  const [loadingTranslations, setLoadingTranslations] = useState({}); // messageId -> true

  const [recording, setRecording] = useState(null); // { startedAt } while the mic is on
  const [transcribing, setTranscribing] = useState(false);
  const [, setTick] = useState(0); // re-render once a second for the recording timer
  const recorderRef = useRef(null);
  const messageCount = useRef(0);
  messageCount.current = messages.length;

  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const menuRef = useRef(null);

  // Load session, transcript and profile. Works after a refresh because everything is in the DB.
  useEffect(() => {
    let cancelled = false;
    Promise.all([getSessionWithMessages(sessionId), getProfile()])
      .then(([{ session: s, messages: m }, p]) => {
        if (cancelled) return;
        if (!s) setLoadError("This chat doesn't exist or isn't yours.");
        setSession(s);
        setMessages(m);
        setProfile(p);
      })
      .catch((e) => !cancelled && setLoadError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      stopTutorAudio();
      recorderRef.current?.cancel();
      recorderRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pending?.text, pending?.reply]);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
      if (!e.target.closest?.(".word-wrap")) setGloss(null);
    };
    const onKey = (e) => e.key === "Escape" && setGloss(null);
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const topic = topicOf(session?.topic);
  const active = session?.status === "active";
  const learnerHasSpoken = messages.some((m) => m.role === "user");

  function playMessage(m, slow = false) {
    const key = slow ? `${m.id}:slow` : `${m.id}`;
    if (speakingKey === key) {
      stopTutorAudio();
      setSpeakingKey(null);
      return;
    }
    setSpeakingKey(key);
    playTutorMessage(m, { slow, onEnd: () => setSpeakingKey((cur) => (cur === key ? null : cur)) });
  }

  function toggleAutoplay() {
    const next = !autoplay;
    setAutoplay(next);
    localStorage.setItem(AUTOPLAY_KEY, next ? "on" : "off");
    if (!next) stopTutorAudio();
  }

  async function handleSend(textArg) {
    const text = (textArg ?? input).trim();
    if (!text || pending || !active || finishing || recording) return;
    setSendError("");
    setGloss(null);
    setPending({ text, reply: "" });
    setInput("");
    try {
      const rows = await sendMessageStream(sessionId, text, {
        onDelta: (chunk) => setPending((p) => (p ? { ...p, reply: p.reply + chunk } : p)),
      });
      setMessages((prev) => [...prev, ...rows]);
      const tutor = rows.find((r) => r.role === "tutor");
      if (autoplay && tutor && tutor.language !== "en") playMessage(tutor); // autoplay is for Spanish listening practice
    } catch (e) {
      // The reply may have been saved even if the stream broke: check before offering a retry.
      let saved = false;
      try {
        const { messages: fresh } = await getSessionWithMessages(sessionId);
        if (fresh.length > messageCount.current) {
          setMessages(fresh);
          saved = true;
        }
      } catch {
        /* keep the original error */
      }
      if (!saved) {
        setInput(text); // give the learner their text back to retry
        setSendError(e.message);
      }
    } finally {
      setPending(null);
      inputRef.current?.focus();
    }
  }

  async function startMic() {
    if (pending || finishing || recording || transcribing || !active) return;
    setSendError("");
    stopTutorAudio();
    setSpeakingKey(null);
    try {
      recorderRef.current = await startRecording({ maxMs: MAX_RECORDING_MS, onLimit: () => stopMicAndSend() });
      setRecording({ startedAt: Date.now() });
    } catch (e) {
      setSendError(
        e?.name === "NotAllowedError"
          ? "Microphone access is blocked. Allow it for this site in your browser settings to talk to Mateo."
          : "Couldn't start the microphone.",
      );
    }
  }

  async function stopMicAndSend() {
    const rec = recorderRef.current;
    if (!rec) return;
    recorderRef.current = null;
    setRecording(null);
    setTranscribing(true);
    let text = "";
    try {
      const blob = await rec.stop();
      text = await transcribeAudio(blob);
    } catch (e) {
      setSendError(e.message);
    } finally {
      setTranscribing(false);
    }
    if (text) await handleSend(text);
  }

  function cancelMic() {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setRecording(null);
  }

  async function handleFinish() {
    setMenuOpen(false);
    stopTutorAudio();
    setSendError("");
    setFinishing(true);
    try {
      const { report, profile: updated } = await completeSession(sessionId);
      if (!report) return navigate("/practice"); // nothing was said; the empty session is discarded
      setProfile(updated);
      setSession((s) => ({ ...s, status: "completed" }));
      const final = { report, newElo: updated.overall_elo };
      setFinalReport(final);
      setResult(final);
    } catch (e) {
      setSendError(e.message);
    } finally {
      setFinishing(false);
    }
  }

  async function openGloss(messageId, index, word) {
    const key = `${messageId}:${index}`;
    if (gloss?.key === key) return setGloss(null);
    const cacheKey = `${messageId}:${word.toLowerCase()}`;
    const cached = glossCache.current.get(cacheKey);
    if (cached) return setGloss({ key, word, status: "ok", ...cached });

    setGloss({ key, word, status: "loading" });
    try {
      const r = await translateWord(messageId, word);
      glossCache.current.set(cacheKey, r);
      setGloss((g) => (g?.key === key ? { key, word, status: "ok", ...r } : g));
    } catch (e) {
      setGloss((g) => (g?.key === key ? { key, word, status: "error", error: e.message } : g));
    }
  }

  async function toggleTranslation(m) {
    if (openTranslations[m.id]) {
      setOpenTranslations((o) => without(o, m.id));
      return;
    }
    setOpenTranslations((o) => ({ ...o, [m.id]: true }));
    if (m.translation) return;

    setLoadingTranslations((l) => ({ ...l, [m.id]: true }));
    try {
      const translation = await translateMessage(m.id);
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, translation } : x)));
    } catch (e) {
      setOpenTranslations((o) => without(o, m.id));
      setSendError(e.message);
    } finally {
      setLoadingTranslations((l) => without(l, m.id));
    }
  }

  function insertAccent(ch) {
    const el = inputRef.current;
    if (!el) return setInput((v) => v + ch);
    const start = el.selectionStart ?? input.length;
    const end = el.selectionEnd ?? input.length;
    const next = input.slice(0, start) + ch + input.slice(end);
    setInput(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + ch.length, start + ch.length);
    });
  }

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  if (loading) return <div className="cv-loading">Cargando la conversación…</div>;
  if (loadError) {
    return (
      <div className="cv-loading">
        <div className="chat-loaderr">
          <div className="cv-error">{loadError}</div>
          <button className="cv-btn" onClick={() => navigate("/practice")}>Start a new chat</button>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-page">
      <div className="chat-box">
        <header className="chat-header">
          <button className="cv-icon-btn" aria-label="Back to progress" onClick={() => navigate("/profile")}>
            ←
          </button>
          <div className="chat-header__avatar">M</div>
          <div className="chat-header__who">
            <div className="chat-header__title">
              Mateo <span className={`chat-status ${pending ? "is-busy" : ""}`}>{pending ? "escribiendo…" : "en línea"}</span>
            </div>
            <div className="chat-header__sub">
              {topic.emoji} {topic.label} · Your Elo {profile?.overall_elo ?? "—"}
              {active && session?.placement ? ` · Placement ${session.placement}/3` : ""}
            </div>
          </div>

          <div className="chat-header__actions" ref={menuRef}>
            <button
              className={`cv-icon-btn ${autoplay ? "is-on" : ""}`}
              onClick={toggleAutoplay}
              aria-pressed={autoplay}
              title={autoplay ? "Auto-play voice: on" : "Auto-play voice: off"}
            >
              {autoplay ? "🔊" : "🔇"}
            </button>
            {active ? (
              <button
                className="cv-btn cv-btn--primary cv-btn--sm"
                onClick={handleFinish}
                disabled={finishing || !!pending}
              >
                {finishing ? <><span className="cv-spinner" /> Scoring…</> : learnerHasSpoken ? "Finish" : "Leave"}
              </button>
            ) : (
              <button className="cv-btn cv-btn--sm" onClick={() => setResult(finalReport ?? { report: reportFromSession(session), newElo: session.new_elo ?? null })}>
                See report
              </button>
            )}
            <button
              className="cv-icon-btn"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Menu"
              onClick={() => setMenuOpen((v) => !v)}
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="chat-menu" role="menu">
                <button role="menuitem" onClick={() => navigate("/profile")}>My progress</button>
                <button role="menuitem" onClick={() => navigate("/practice")}>New topic / settings</button>
                <button role="menuitem" className="danger" onClick={() => signOut()}>Log out</button>
              </div>
            )}
          </div>
        </header>

        <div className="chat-messages">
          {messages.length === 0 && !pending && (
            <div className="chat-empty">
              <div className="chat-empty__wave">👋</div>
              <p className="chat-empty__title">¡Hola! Soy Mateo.</p>
              <p className="cv-muted">
                Write to me in Spanish about <strong>{topic.label.toLowerCase()}</strong>. Don't worry about mistakes. I'll help you fix them as we go.
              </p>
              {active && (
                <div className="chat-starters">
                  {topic.starters.map((s) => (
                    <button key={s} className="chat-starter" onClick={() => setInput(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {messages.map((m) =>
            m.role === "user" ? (
              <div className="msg-row right" key={m.id}>
                <div className="bubble user">{m.content}</div>
              </div>
            ) : (
              <div className="msg-row left" key={m.id}>
                <div className="msg-avatar">M</div>
                <div className="msg-col">
                  <div className="bubble tutor">
                    <span className="bubble__text">
                      <TappableText text={m.content} messageId={m.id} gloss={gloss} onWord={openGloss} />
                    </span>
                  </div>
                  <div className="bubble__tools">
                    <button
                      className={`bubble__tool ${speakingKey === `${m.id}` ? "is-on" : ""}`}
                      onClick={() => playMessage(m)}
                      title={speakingKey === `${m.id}` ? "Stop" : "Play aloud"}
                    >
                      {speakingKey === `${m.id}` ? "■ Stop" : "🔊 Play"}
                    </button>
                    <button
                      className={`bubble__tool ${speakingKey === `${m.id}:slow` ? "is-on" : ""}`}
                      onClick={() => playMessage(m, true)}
                      title={speakingKey === `${m.id}:slow` ? "Stop" : "Play slowly"}
                    >
                      {speakingKey === `${m.id}:slow` ? "■ Stop" : "🐢 Slow"}
                    </button>
                    <button
                      className={`bubble__tool ${openTranslations[m.id] ? "is-on" : ""}`}
                      onClick={() => toggleTranslation(m)}
                      aria-expanded={!!openTranslations[m.id]}
                      title="Show the English translation"
                    >
                      EN
                    </button>
                  </div>
                  {openTranslations[m.id] && (
                    <div className="bubble__translation">
                      {loadingTranslations[m.id] ? <span className="cv-muted">Translating…</span> : m.translation}
                    </div>
                  )}
                  {m.correction && <CorrectionTip c={m.correction} />}
                </div>
              </div>
            ),
          )}

          {pending && (
            <>
              <div className="msg-row right">
                <div className="bubble user is-pending">{pending.text}</div>
              </div>
              <div className="msg-row left">
                <div className="msg-avatar">M</div>
                {pending.reply ? (
                  <div className="msg-col">
                    <div className="bubble tutor is-streaming">
                      <span className="bubble__text">{pending.reply}<span className="caret" aria-hidden /></span>
                    </div>
                  </div>
                ) : (
                  <div className="bubble tutor typing" aria-label="Mateo is typing">
                    <span /><span /><span />
                  </div>
                )}
              </div>
            </>
          )}
          <div ref={bottomRef} />
        </div>

        {sendError && (
          <div className="chat-error">
            <div className="cv-error">{sendError}</div>
          </div>
        )}

        {active ? (
          <div className="composer">
            <div className="composer__accents" aria-label="Spanish characters">
              {ACCENT_KEYS.map((k) => (
                <button key={k} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertAccent(k)}>
                  {k}
                </button>
              ))}
            </div>
            <div className="composer__row">
              {micSupported && (
                <button
                  type="button"
                  className={`composer__mic ${recording ? "is-recording" : ""}`}
                  onClick={recording ? stopMicAndSend : startMic}
                  disabled={!!pending || finishing || transcribing}
                  aria-label={recording ? "Stop and send" : "Speak to Mateo"}
                  title={recording ? "Stop and send" : "Speak to Mateo"}
                >
                  {recording ? "■" : "🎙️"}
                </button>
              )}
              {recording || transcribing ? (
                <div className="composer__status" role="status">
                  {recording ? (
                    <>
                      <span className="rec-dot" aria-hidden /> Listening… {fmtClock(Date.now() - recording.startedAt)}
                      <span className="cv-muted"> · press ■ to send</span>
                      <button type="button" className="composer__cancel" onClick={cancelMic}>Cancel</button>
                    </>
                  ) : (
                    <><span className="cv-spinner" /> Transcribing…</>
                  )}
                </div>
              ) : (
                <textarea
                  ref={inputRef}
                  placeholder="Escribe en español…"
                  rows={1}
                  value={input}
                  maxLength={2000}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  disabled={finishing}
                  autoFocus
                />
              )}
              <button
                className="cv-btn cv-btn--primary"
                onClick={() => handleSend()}
                disabled={!input.trim() || !!pending || finishing || !!recording || transcribing}
              >
                Enviar
              </button>
            </div>
          </div>
        ) : (
          <div className="composer composer--done">
            <span className="cv-muted">This session is finished.</span>
            <button className="cv-btn cv-btn--primary cv-btn--sm" onClick={() => navigate("/practice")}>
              New session
            </button>
          </div>
        )}
      </div>

      {result && (
        <ResultsModal
          report={result.report}
          newElo={result.newElo}
          onClose={() => setResult(null)}
          onPracticeAgain={() => navigate("/practice")}
          onViewProgress={() => navigate("/profile")}
          onReviewWords={() => navigate("/words")}
        />
      )}
    </div>
  );
}

/** Mateo's text with every word tappable for an in-context translation. */
function TappableText({ text, messageId, gloss, onWord }) {
  return text.split(WORD_SPLIT).map((part, i) => {
    if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
    const open = gloss?.key === `${messageId}:${i}`;
    return (
      <span className="word-wrap" key={i}>
        <button type="button" className={`word ${open ? "is-open" : ""}`} onClick={() => onWord(messageId, i, part)}>
          {part}
        </button>
        {open && (
          <span className="gloss" role="tooltip">
            {gloss.status === "loading" && <span className="cv-muted">…</span>}
            {gloss.status === "error" && <span className="gloss__error">{gloss.error}</span>}
            {gloss.status === "ok" && (
              <>
                <span className="gloss__top">
                  <strong>{gloss.translation}</strong>
                  {speechSupported && (
                    <button type="button" className="gloss__say" onClick={() => speak(gloss.word)} aria-label={`Say ${gloss.word}`}>
                      🔊
                    </button>
                  )}
                </span>
                {gloss.note && <span className="gloss__note">{gloss.note}</span>}
              </>
            )}
          </span>
        )}
      </span>
    );
  });
}

function CorrectionTip({ c }) {
  return (
    <div className={`tip tip--${c.severity || "low"}`}>
      <div className="tip__label">Mateo's tip</div>
      <div className="tip__fix">
        <s>{c.original}</s> <span aria-hidden>→</span> <strong>{c.corrected}</strong>
      </div>
      {c.explanation && <div className="tip__why">{c.explanation}</div>}
    </div>
  );
}
