import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./WordsScreen.css";
import TopBar from "./TopBar";
import { forgetWord, getWords, reviewWord } from "./api";
import { speak, speechSupported } from "./speech";
import { formatInterval, schedule } from "../supabase/functions/_shared/srs.ts";

const GRADES = [
  { id: "again", label: "Again", key: "1" },
  { id: "good", label: "Good", key: "2" },
  { id: "easy", label: "Easy", key: "3" },
];

function dueLabel(dueAt, now) {
  const ms = new Date(dueAt).getTime() - now;
  if (ms <= 0) return "due now";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `in ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `in ${h} h`;
  return `in ${formatInterval(Math.round(h / 24))}`;
}

/** Example sentence with the practised word highlighted. */
function Example({ text, word }) {
  if (!text) return null;
  const i = text.toLowerCase().indexOf(word.toLowerCase());
  if (i < 0) return <p className="wd-example">{text}</p>;
  return (
    <p className="wd-example">
      {text.slice(0, i)}
      <mark>{text.slice(i, i + word.length)}</mark>
      {text.slice(i + word.length)}
    </p>
  );
}

export default function WordsScreen() {
  const navigate = useNavigate();
  const [words, setWords] = useState(null);
  const [queue, setQueue] = useState([]); // ids to review this sitting, in order
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    getWords()
      .then((all) => {
        setWords(all);
        const now = Date.now();
        setQueue(all.filter((w) => new Date(w.due_at).getTime() <= now).map((w) => w.id));
      })
      .catch((e) => setError(e.message));
  }, []);

  const current = useMemo(() => words?.find((w) => w.id === queue[0]) ?? null, [words, queue]);

  const grade = useCallback(
    async (g) => {
      if (!current || !revealed) return;
      setError("");
      const next = schedule(current, g, new Date());
      setWords((ws) => ws.map((w) => (w.id === current.id ? { ...w, ...next } : w)));
      setQueue((q) => (g === "again" ? [...q.slice(1), q[0]] : q.slice(1))); // "Again" comes back this sitting
      setRevealed(false);
      setReviewed((n) => n + 1);
      try {
        await reviewWord(current.id, next);
      } catch (e) {
        setError(`Couldn't save that review: ${e.message}`);
      }
    },
    [current, revealed],
  );

  useEffect(() => {
    const onKey = (e) => {
      if (!current || e.target.closest?.("input, textarea")) return;
      if (e.key === " " && !revealed) {
        e.preventDefault();
        setRevealed(true);
      }
      const g = GRADES.find((x) => x.key === e.key);
      if (g && revealed) grade(g.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, revealed, grade]);

  async function onForget(id) {
    const prev = words;
    setWords((ws) => ws.filter((w) => w.id !== id));
    setQueue((q) => q.filter((x) => x !== id));
    try {
      await forgetWord(id);
    } catch (e) {
      setWords(prev);
      setError(e.message);
    }
  }

  if (!words && !error) return <div className="cv-loading">Cargando tus palabras…</div>;

  const now = Date.now();
  const dueCount = queue.length;
  const nextDue = words?.filter((w) => new Date(w.due_at).getTime() > now).sort((a, b) => new Date(a.due_at) - new Date(b.due_at))[0];

  return (
    <div className="cv-page">
      <TopBar />
      <div className="cv-container wd">
        <div className="wd-head">
          <h1 className="cv-h1">Palabras</h1>
          {words && (
            <p className="cv-muted">
              {words.length} word{words.length === 1 ? "" : "s"} · {dueCount} to review now
            </p>
          )}
        </div>

        {error && <div className="cv-error">{error}</div>}

        {words?.length === 0 ? (
          <section className="cv-card wd-empty">
            <p>Your flashcards appear here after your chats with Mateo: new words from each session, and the words he works into the conversation for your level.</p>
            <button className="cv-btn cv-btn--primary" onClick={() => navigate("/practice")}>Start a chat</button>
          </section>
        ) : current ? (
          <section className="cv-card wd-card" aria-live="polite">
            <div className="wd-card__top">
              <span className="cv-small cv-muted">{dueCount} left{reviewed ? ` · ${reviewed} done` : ""}</span>
              <span className="wd-source">{current.source === "list" ? "From your level's word list" : "From a session"}</span>
            </div>
            <div className="wd-word">
              {current.spanish}
              {speechSupported && (
                <button className="wd-say" onClick={() => speak(current.spanish)} aria-label={`Say ${current.spanish}`}>🔊</button>
              )}
            </div>
            <Example text={current.example} word={current.spanish} />
            {revealed ? (
              <>
                <div className="wd-answer">{current.english}</div>
                <div className="wd-grades">
                  {GRADES.map((g) => (
                    <button key={g.id} className={`wd-grade wd-grade--${g.id}`} onClick={() => grade(g.id)}>
                      <span>{g.label}</span>
                      <span className="wd-grade__when">{formatInterval(schedule(current, g.id, new Date()).interval_days)}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <button className="cv-btn cv-btn--primary wd-reveal" onClick={() => setRevealed(true)}>
                Show meaning <span className="cv-muted cv-small">(space)</span>
              </button>
            )}
          </section>
        ) : (
          <section className="cv-card wd-empty">
            <div className="wd-done">¡Todo listo! 🎉</div>
            <p className="cv-muted">
              {reviewed ? `You reviewed ${reviewed} card${reviewed === 1 ? "" : "s"}. ` : "Nothing to review right now. "}
              {nextDue ? `Next review ${dueLabel(nextDue.due_at, now)}.` : ""}
            </p>
          </section>
        )}

        {words?.length > 0 && (
          <section className="cv-card">
            <h2 className="cv-card__title">All words</h2>
            <div className="wd-list" role="table">
              {words.map((w) => (
                <Fragment key={w.id}>
                  <span className="wd-list__es">{w.spanish}</span>
                  <span className="wd-list__en cv-muted">{w.english}</span>
                  <span className="wd-list__due cv-small cv-muted">{dueLabel(w.due_at, now)}</span>
                  <button className="wd-list__forget" onClick={() => onForget(w.id)} aria-label={`Remove ${w.spanish}`} title="Remove">✕</button>
                </Fragment>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
