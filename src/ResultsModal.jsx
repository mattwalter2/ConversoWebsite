import { useEffect } from "react";
import "./ResultsModal.css";
import { SKILLS, levelName } from "./spanish";
import { speak, speechSupported } from "./speech";

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

/** End-of-session report: Elo change, per-skill deltas, feedback, and new words. */
export default function ResultsModal({ report, newElo, onClose, onPracticeAgain, onViewProgress, onReviewWords }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const delta = report.overallDelta ?? 0;

  return (
    <div className="rm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rm" role="dialog" aria-modal="true" aria-labelledby="rm-title">
        <button className="rm-close cv-icon-btn" onClick={onClose} aria-label="Close">✕</button>

        {report.placement ? (
          // Placement: the point is "here's your level", not a win/loss, so no red/green delta.
          <div className="rm-hero">
            <div className="rm-hero__label" id="rm-title">Placement session {report.placement} of 3 · finding your level</div>
            {newElo != null ? (
              <>
                <div className="rm-hero__delta rm-hero__level">Your level: {newElo}</div>
                <div className="cv-muted">
                  {levelName(newElo)} · {delta === 0 ? "unchanged" : `moved from ${newElo - delta}`}
                </div>
              </>
            ) : (
              <div className="rm-hero__delta rm-hero__level">Level {delta > 0 ? "raised" : delta < 0 ? "lowered" : "unchanged"} {delta !== 0 && `by ${Math.abs(delta)}`}</div>
            )}
          </div>
        ) : (
          <div className="rm-hero">
            <div className="rm-hero__label" id="rm-title">¡Buen trabajo! Session complete</div>
            <div className={`rm-hero__delta ${delta > 0 ? "pos" : delta < 0 ? "neg" : ""}`}>{signed(delta)} Elo</div>
            {newElo != null && (
              <div className="cv-muted">
                Now {newElo} · {levelName(newElo)}
              </div>
            )}
          </div>
        )}

        {report.placement && (
          <div className="rm-placement">
            Your first 3 sessions set your starting level, so it can move a lot. After that it changes by
            up to ±20 per session.
          </div>
        )}

        {report.summary && <p className="rm-summary">{report.summary}</p>}

        <div className="rm-grid">
          <section>
            <h3>Skills</h3>
            <ul className="rm-skills">
              {SKILLS.map((s) => {
                const d = report.skillDeltas?.[s.key] ?? 0;
                return (
                  <li key={s.key}>
                    <span>{s.label}</span>
                    <span className={d > 0 ? "pos" : d < 0 ? "neg" : "cv-muted"}>{signed(d)}</span>
                  </li>
                );
              })}
              {report.accuracy != null && (
                <li className="rm-skills__acc">
                  <span>Accuracy</span>
                  <span>{report.accuracy}%</span>
                </li>
              )}
            </ul>
          </section>

          <section>
            {report.strengths?.length > 0 && (
              <>
                <h3>What went well</h3>
                <ul className="rm-list rm-list--good">
                  {report.strengths.map((s) => <li key={s}>{s}</li>)}
                </ul>
              </>
            )}
            {report.improvements?.length > 0 && (
              <>
                <h3>Work on next</h3>
                <ul className="rm-list rm-list--next">
                  {report.improvements.map((s) => <li key={s}>{s}</li>)}
                </ul>
              </>
            )}
          </section>
        </div>

        {report.newWords?.length > 0 && (
          <section className="rm-words">
            <h3>New words</h3>
            <ul>
              {report.newWords.map((w) => (
                <li key={w.spanish}>
                  <div className="rm-word">
                    <strong>{w.spanish}</strong>
                    {speechSupported && (
                      <button className="rm-say" onClick={() => speak(w.spanish)} aria-label={`Say ${w.spanish}`}>🔊</button>
                    )}
                    <span className="cv-muted">· {w.english}</span>
                  </div>
                  {w.context && <div className="rm-word__ctx">{w.context}</div>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="rm-actions">
          <button className="cv-btn" onClick={onViewProgress}>View progress</button>
          {onReviewWords && report.newWords?.length > 0 && (
            <button className="cv-btn" onClick={onReviewWords}>Review words</button>
          )}
          <button className="cv-btn cv-btn--primary" onClick={onPracticeAgain}>Practice again</button>
        </div>
      </div>
    </div>
  );
}
