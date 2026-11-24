import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getProgressSummary, signOut } from "./api";

const LINKS = [
  { to: "/practice", label: "Practice" },
  { to: "/words", label: "Words" },
  { to: "/profile", label: "Progress" },
];

/** Sticky app header: brand, day streak, navigation (with flashcards due), sign-out. */
export default function TopBar({ children }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    getProgressSummary().then(setSummary).catch(() => setSummary(null));
  }, [pathname]);

  const streak = summary?.streak;
  return (
    <header className="cv-topbar">
      <div className="cv-topbar__brand" onClick={() => navigate("/profile")}>
        <span className="cv-badge">C</span>
        Converso
      </div>
      <div className="cv-topbar__spacer" />
      {streak && (
        <span
          className={`cv-streak ${streak.days && !streak.activeToday ? "is-pending" : ""}`}
          title={
            !streak.days
              ? "Finish a session to start a streak"
              : streak.activeToday
                ? `${streak.days}-day streak`
                : `${streak.days}-day streak: finish a session today to keep it`
          }
        >
          🔥 {streak.days}
        </span>
      )}
      <nav className="cv-nav">
        {LINKS.map((l) => (
          <button key={l.to} className={`cv-nav__link ${pathname.startsWith(l.to) ? "is-active" : ""}`} onClick={() => navigate(l.to)}>
            {l.label}
            {l.to === "/words" && summary?.due > 0 && <span className="cv-nav__count">{summary.due}</span>}
          </button>
        ))}
      </nav>
      {children}
      <button className="cv-btn cv-btn--ghost cv-btn--sm" onClick={() => signOut()}>
        Log out
      </button>
    </header>
  );
}
