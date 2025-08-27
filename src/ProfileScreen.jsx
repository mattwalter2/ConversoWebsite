// ProfileScreen.jsx
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import "./ProfileScreen.css";

/**
 * ProfileScreen (User-only ELO + Profile + Language launcher)
 *
 * Props:
 *  - messages: Array<{ id, role, elo?, delta?, ts }>
 *  - userName?: string                 // fallback initial name
 *  - initialAvatarUrl?: string         // optional avatar URL to prefill
 *
 * If messages is empty, generates a deterministic random-walk (user only).
 */
export default function ProfileScreen({
  messages = [],
  userName = "You",
  initialAvatarUrl = "",
}) {
  const navigate = useNavigate();

  // -------- Profile state --------
  const [displayName, setDisplayName] = useState(userName);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);

  // -------- Language launcher --------
  const LANGS = [
    "Spanish",
    "French",
    "German",
    "Italian",
    "Portuguese",
    "Japanese",
    "Korean",
    "Chinese",
    "Arabic",
    "Russian",
  ];
  const [lang, setLang] = useState(LANGS[0]);

  const onStartChat = () => {
    // Persist like your app expects
    try {
      localStorage.setItem("converso.lang", JSON.stringify({ name: lang }));
    } catch {}
    navigate("/chat");
  };

  // Support avatar from URL or local file
  const onAvatarFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => setAvatarUrl(String(e.target?.result || ""));
    reader.readAsDataURL(file);
  };

  // -------- Chart logic (user ELO only) --------
  const [range, setRange] = useState("30d"); // "7d" | "30d" | "all"
  const toDate = (t) => (t instanceof Date ? t : new Date(t ?? Date.now()));
  const labelDate = (d) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

  function mulberry32(seed) {
    return function () {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function strSeed(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  const sampleMessages = useMemo(() => {
    const N = 45;
    const now = new Date();
    const seed = strSeed(String(displayName || "You"));
    const rnd = mulberry32(seed);
    let userElo = 1500 + Math.floor(rnd() * 100) - 50;

    const out = [];
    for (let i = N - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(now.getDate() - i);

      const uDelta = Math.round((rnd() - 0.5) * 20 + (1500 - userElo) * 0.02);
      userElo += uDelta;

      const ts = new Date(date);
      ts.setHours(9, 0, 0, 0);
      out.push({
        id: `${date.toISOString()}-u`,
        role: "user",
        elo: userElo,
        delta: uDelta,
        ts: ts.toISOString(),
      });
    }
    return out;
  }, [displayName]);

  const inputMessages =
    messages && messages.length > 0
      ? messages.filter((m) => m.role === "user")
      : sampleMessages;

  const series = useMemo(() => {
    const rows = (inputMessages || [])
      .filter((m) => typeof m.elo === "number" && m.ts != null)
      .map((m) => ({
        dt: toDate(m.ts),
        elo: m.elo,
      }))
      .sort((a, b) => a.dt - b.dt);

    return rows.map((r) => ({
      date: r.dt,
      label: labelDate(r.dt),
      userElo: r.elo,
    }));
  }, [inputMessages]);

  const filtered = useMemo(() => {
    if (!series.length || range === "all") return series;
    const now = new Date().getTime();
    const windowMs =
      range === "7d" ? 7 * 24 * 3600 * 1000 : 30 * 24 * 3600 * 1000;
    const since = now - windowMs;
    return series.filter((p) => p.date.getTime() >= since);
  }, [series, range]);

  const first = filtered[0];
  const last = filtered[filtered.length - 1];
  const userChange =
    first && last && first.userElo != null && last.userElo != null
      ? last.userElo - first.userElo
      : 0;

  // Initials fallback for avatar
  const initials =
    (displayName || "You")
      .split(" ")
      .map((s) => s[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "U";

  return (
    <div className="profile-screen profile-screen--full">
      {/* Profile header */}
      <div className="ps-profile">
        <div className="ps-avatar">
          {avatarUrl ? (
            <img src={avatarUrl} alt="avatar" />
          ) : (
            <div className="ps-avatar__fallback">{initials}</div>
          )}
          <div className="ps-avatar__actions">
            <input
              type="url"
              placeholder="Paste image URL"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              className="ps-input"
            />
            <label className="ps-file">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => onAvatarFile(e.target.files?.[0])}
              />
              Upload
            </label>
          </div>
        </div>

        <div className="ps-profile__meta">
          <label className="ps-label">Display name</label>
          <input
            className="ps-input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
          />

          <div className="ps-launcher">
            <div className="ps-launcher__row">
              <label className="ps-label" htmlFor="lang">
                Practice language
              </label>
              <select
                id="lang"
                className="ps-select"
                value={lang}
                onChange={(e) => setLang(e.target.value)}
              >
                {LANGS.map((L) => (
                  <option key={L} value={L}>
                    {L}
                  </option>
                ))}
              </select>
            </div>

            <button className="ps-btn ps-btn--primary" onClick={onStartChat}>
              Start Chat in {lang}
            </button>
          </div>
        </div>
      </div>

      {/* Header + controls */}
      <div className="ps-header">
        <h2 className="ps-title">ELO History</h2>
        <div className="ps-controls">
          <div className="ps-range">
            <button
              className={`ps-btn ${range === "7d" ? "ps-btn--primary" : ""}`}
              onClick={() => setRange("7d")}
            >
              7d
            </button>
            <button
              className={`ps-btn ${range === "30d" ? "ps-btn--primary" : ""}`}
              onClick={() => setRange("30d")}
            >
              30d
            </button>
            <button
              className={`ps-btn ${range === "all" ? "ps-btn--primary" : ""}`}
              onClick={() => setRange("all")}
            >
              All
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="ps-stats">
        <div className="ps-stat">
          <div className="ps-stat__label">
            {displayName || "You"} change ({range})
          </div>
          <div className={`ps-stat__value ${userChange >= 0 ? "pos" : "neg"}`}>
            {userChange >= 0 ? "+" : ""}
            {Math.round(userChange)}
          </div>
        </div>
        <div className="ps-stat">
          <div className="ps-stat__label">{displayName || "You"} latest</div>
          <div className="ps-stat__value">{last?.userElo ?? "—"}</div>
        </div>
      </div>

      {/* Chart */}
      <div className="ps-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={filtered}
            margin={{ top: 16, right: 24, bottom: 8, left: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" minTickGap={24} />
            <YAxis allowDecimals={false} />
            <Tooltip
              formatter={(value, name) => {
                if (name === "userElo")
                  return [value, `${displayName || "You"} ELO`];
                return [value, name];
              }}
            />
            <Line
              type="monotone"
              dataKey="userElo"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}