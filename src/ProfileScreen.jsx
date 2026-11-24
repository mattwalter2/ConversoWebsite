import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./ProfileScreen.css";
import TopBar from "./TopBar";
import {
  forgetAllMemory,
  forgetMemory,
  getCompletedSessions,
  getEloHistory,
  getMemory,
  getProfile,
  getTopicRatings,
  getWords,
  updateProfile,
} from "./api";
import { SKILLS, TOPICS, levelName, topicOf } from "./spanish";
import { dayStreak } from "../supabase/functions/_shared/streak.ts";

const DAY = 24 * 3600 * 1000;
const RANGES = { "7d": 7 * DAY, "30d": 30 * DAY, all: Infinity };
const ACCENT = "#6ee7b7";
const AXIS = "#8b94b8";
const GRID = "#21254a";

const fmtDay = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

export default function ProfileScreen() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [history, setHistory] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState("");
  const [range, setRange] = useState("30d");
  const [memory, setMemory] = useState([]);
  const [topicRatings, setTopicRatings] = useState({});
  const [wordCount, setWordCount] = useState(0);
  const [confirmForget, setConfirmForget] = useState(false);

  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([getProfile(), getEloHistory(), getCompletedSessions(), getMemory(), getTopicRatings(), getWords()])
      .then(([p, h, s, m, t, w]) => {
        if (!p) throw new Error("Your profile is missing. Try signing out and back in.");
        setProfile(p);
        setHistory(h);
        setSessions(s);
        setMemory(m);
        setTopicRatings(t);
        setWordCount(w.length);
        setName(p?.display_name ?? "");
        setAvatar(p?.avatar_url ?? "");
      })
      .catch((e) => setError(e.message));
  }, []);

  // Overall Elo over time, with a synthetic first point at the pre-first-session rating.
  const series = useMemo(() => {
    if (!history.length) return [];
    const first = history[0];
    const firstAt = new Date(first.created_at).getTime();
    return [
      { t: firstAt - 60_000, elo: first.new_elo - first.delta },
      ...history.map((h) => ({ t: new Date(h.created_at).getTime(), elo: h.new_elo })),
    ].map((p) => ({ ...p, label: fmtDay(new Date(p.t)) }));
  }, [history]);

  const visible = useMemo(() => {
    const since = Date.now() - RANGES[range];
    const inRange = series.filter((p) => p.t >= since);
    return inRange.length >= 2 ? inRange : series.slice(-Math.max(2, inRange.length));
  }, [series, range]);

  const radar = useMemo(
    () => (profile ? SKILLS.map((s) => ({ skill: s.label, elo: profile[`${s.key}_elo`] })) : []),
    [profile],
  );
  const radarMax = Math.max(800, Math.ceil(Math.max(0, ...radar.map((r) => r.elo)) / 400) * 400);

  const streak = dayStreak(sessions.map((s) => s.ended_at));
  const scored = sessions.filter((s) => s.accuracy != null);
  const avgAccuracy = scored.length
    ? `${Math.round(scored.reduce((n, s) => n + s.accuracy, 0) / scored.length)}%`
    : "—";
  const dirty = profile && (name !== (profile.display_name ?? "") || avatar !== (profile.avatar_url ?? ""));

  async function onForget(id) {
    const prev = memory;
    setMemory((m) => m.filter((x) => x.id !== id)); // optimistic
    try {
      await forgetMemory(id);
    } catch (err) {
      setMemory(prev);
      setError(err.message);
    }
  }

  async function onForgetAll() {
    const prev = memory;
    setMemory([]);
    setConfirmForget(false);
    try {
      await forgetAllMemory();
    } catch (err) {
      setMemory(prev);
      setError(err.message);
    }
  }

  async function onSave(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const p = await updateProfile({ display_name: name.trim() || null, avatar_url: avatar.trim() || null });
      setProfile(p);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!profile && !error) return <div className="cv-loading">Cargando…</div>;

  const initials =
    (profile?.display_name || "Tú")
      .split(" ")
      .map((s) => s[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();

  return (
    <div className="cv-page">
      <TopBar />

      <div className="cv-container ps">
        {error && <div className="cv-error">{error}</div>}

        {profile && (
          <>
            <section className="cv-card ps-hero">
              <div className="ps-avatar">
                {profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : <span>{initials}</span>}
              </div>
              <form className="ps-identity" onSubmit={onSave}>
                <input
                  className="cv-input ps-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  aria-label="Display name"
                />
                <input
                  className="cv-input"
                  type="url"
                  value={avatar}
                  onChange={(e) => setAvatar(e.target.value)}
                  placeholder="Avatar image URL (optional)"
                  aria-label="Avatar image URL"
                />
                <div className="ps-identity__row">
                  {dirty && (
                    <button className="cv-btn cv-btn--sm" type="submit" disabled={saving}>
                      {saving ? "Saving…" : "Save"}
                    </button>
                  )}
                  {saved && <span className="cv-small pos">Saved</span>}
                </div>
              </form>
              <div className="ps-elo">
                <div className="ps-elo__value">{profile.overall_elo}</div>
                <div className="ps-elo__label">Elo · {levelName(profile.overall_elo)}</div>
                <button className="cv-btn cv-btn--primary" onClick={() => navigate("/practice")}>
                  Start practice
                </button>
              </div>
            </section>

            <section className="ps-stats">
              <Stat label="Sessions" value={sessions.length} />
              <Stat label="Day streak" value={`🔥 ${streak.days}`} />
              <Stat label="Words" value={wordCount} />
              <Stat label="Avg accuracy" value={avgAccuracy} />
            </section>

            <div className="ps-charts">
              <section className="cv-card">
                <div className="ps-card-head">
                  <h2 className="cv-card__title">Elo history</h2>
                  <div className="cv-segment">
                    {Object.keys(RANGES).map((r) => (
                      <button key={r} className={range === r ? "is-active" : ""} onClick={() => setRange(r)}>
                        {r === "all" ? "All" : r}
                      </button>
                    ))}
                  </div>
                </div>
                {series.length ? (
                  <div className="ps-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={visible} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
                        <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                        <XAxis dataKey="label" stroke={AXIS} tick={{ fontSize: 12 }} minTickGap={24} />
                        <YAxis stroke={AXIS} tick={{ fontSize: 12 }} domain={["dataMin - 20", "dataMax + 20"]} allowDecimals={false} />
                        <Tooltip
                          contentStyle={{ background: "#11152e", border: "1px solid #2a2f5a", borderRadius: 10 }}
                          labelStyle={{ color: "#c7ceff" }}
                          formatter={(v) => [v, "Elo"]}
                        />
                        <Line type="monotone" dataKey="elo" stroke={ACCENT} strokeWidth={2.5} dot={{ r: 3, fill: ACCENT }} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <Empty>Finish your first session to start your Elo chart.</Empty>
                )}
              </section>

              <section className="cv-card">
                <h2 className="cv-card__title">Skills</h2>
                <div className="ps-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radar} outerRadius="72%">
                      <PolarGrid stroke={GRID} />
                      <PolarAngleAxis dataKey="skill" tick={{ fill: "#c7ceff", fontSize: 12 }} />
                      <PolarRadiusAxis domain={[0, radarMax]} tick={false} axisLine={false} />
                      <Tooltip
                        contentStyle={{ background: "#11152e", border: "1px solid #2a2f5a", borderRadius: 10 }}
                        formatter={(v) => [v, "Elo"]}
                      />
                      <Radar dataKey="elo" stroke={ACCENT} fill={ACCENT} fillOpacity={0.25} isAnimationActive={false} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            </div>

            <section className="cv-card">
              <h2 className="cv-card__title">Elo by topic</h2>
              <ul className="ps-topics">
                {TOPICS.map((t) => {
                  const r = topicRatings[t.key];
                  return (
                    <li key={t.key}>
                      <span className="ps-topics__name">
                        <span aria-hidden>{t.emoji}</span> {t.label}
                      </span>
                      <span className="ps-topics__bar" aria-hidden>
                        {r && <span style={{ width: `${Math.max(3, (r.elo / 2400) * 100)}%` }} />}
                      </span>
                      <span className="ps-topics__elo">
                        {r ? <>{r.elo} <span className="cv-muted cv-small">· {r.sessions} session{r.sessions === 1 ? "" : "s"}</span></> : <span className="cv-muted cv-small">Not played yet</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="cv-card">
              <div className="ps-card-head">
                <h2 className="cv-card__title">What Mateo remembers</h2>
                {memory.length > 0 &&
                  (confirmForget ? (
                    <div className="ps-forget">
                      <span className="cv-small cv-muted">Forget everything?</span>
                      <button className="cv-btn cv-btn--sm" onClick={onForgetAll}>Yes, forget</button>
                      <button className="cv-btn cv-btn--sm" onClick={() => setConfirmForget(false)}>Cancel</button>
                    </div>
                  ) : (
                    <button className="cv-btn cv-btn--sm" onClick={() => setConfirmForget(true)}>Forget everything</button>
                  ))}
              </div>
              {memory.length ? (
                <div className="ps-memory">
                  <MemoryList title="About you" items={memory.filter((m) => m.kind === "fact")} onForget={onForget} />
                  <MemoryList title="Mistakes he's helping with" items={memory.filter((m) => m.kind === "mistake")} onForget={onForget} />
                </div>
              ) : (
                <Empty>Chat with Mateo and he'll remember things you tell him, like your job or plans, and the mistakes you keep making.</Empty>
              )}
            </section>

            <section className="cv-card">
              <h2 className="cv-card__title">Recent sessions</h2>
              {sessions.length ? (
                <ul className="ps-sessions">
                  {sessions.slice(0, 10).map((s) => {
                    const t = topicOf(s.topic);
                    const d = s.overall_delta ?? 0;
                    return (
                      <li key={s.id} onClick={() => navigate(`/chat/${s.id}`)}>
                        <span className="ps-sessions__emoji" aria-hidden>{t.emoji}</span>
                        <div className="ps-sessions__body">
                          <div className="ps-sessions__top">
                            <strong>{t.label}</strong>
                            <span className="cv-small cv-muted">{fmtDay(new Date(s.ended_at))}</span>
                          </div>
                          {s.summary && <div className="cv-small cv-muted ps-sessions__summary">{s.summary}</div>}
                        </div>
                        <span className={`ps-delta ${d > 0 ? "pos" : d < 0 ? "neg" : ""}`}>{d > 0 ? `+${d}` : d}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Empty>No sessions yet. ¡Vamos! Start your first chat with Mateo.</Empty>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="cv-card ps-stat">
      <div className="ps-stat__value">{value}</div>
      <div className="ps-stat__label">{label}</div>
    </div>
  );
}

function MemoryList({ title, items, onForget }) {
  return (
    <div>
      <h3 className="ps-memory__title">{title}</h3>
      {items.length ? (
        <ul className="ps-memory__list">
          {items.map((m) => (
            <li key={m.id}>
              <span>{m.content}</span>
              <button className="ps-memory__forget" onClick={() => onForget(m.id)} aria-label={`Forget: ${m.content}`} title="Forget this">
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="cv-small cv-muted">Nothing yet.</p>
      )}
    </div>
  );
}

function Empty({ children }) {
  return <div className="ps-empty cv-muted">{children}</div>;
}
