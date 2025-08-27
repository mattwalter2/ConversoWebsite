// src/SelectLanguageScreen.jsx
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "./supaBaseClient"; // adjust path if needed

/**
 * SelectLanguageScreen.jsx
 * - Searchable grid of language cards with flag emoji
 * - Select a language + (optional) level, then Continue
 * - Persists selection in localStorage (key: converso.lang)
 * - Navigates to /chat after selection
 */

const LANGS = [
  { code: "en", name: "English", native: "English", flag: "🇺🇸" },
  { code: "es", name: "Spanish", native: "Español", flag: "🇪🇸" },
  { code: "fr", name: "French", native: "Français", flag: "🇫🇷" },
  { code: "de", name: "German", native: "Deutsch", flag: "🇩🇪" },
  { code: "it", name: "Italian", native: "Italiano", flag: "🇮🇹" },
  { code: "pt", name: "Portuguese", native: "Português", flag: "🇵🇹" },
  { code: "zh", name: "Chinese", native: "中文", flag: "🇨🇳" },
  { code: "ja", name: "Japanese", native: "日本語", flag: "🇯🇵" },
  { code: "ko", name: "Korean", native: "한국어", flag: "🇰🇷" },
  { code: "ar", name: "Arabic", native: "العربية", flag: "🇸🇦" },
  { code: "ru", name: "Russian", native: "Русский", flag: "🇷🇺" },
  { code: "hi", name: "Hindi", native: "हिन्दी", flag: "🇮🇳" },
];

const LEVELS = [
  { id: "beginner", label: "Beginner" },
  { id: "intermediate", label: "Intermediate" },
  { id: "advanced", label: "Advanced" },
];

export default function SelectLanguageScreen({ onChoose }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [level, setLevel] = useState("beginner");
  const navigate = useNavigate();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return LANGS;
    return LANGS.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.native.toLowerCase().includes(q) ||
        l.code.includes(q)
    );
  }, [query]);

  function generateChatSessionId() {
    const randomNum = Math.floor(100000000000 + Math.random() * 900000000000); // ensures 12-digit number
    console.log(randomNum);
    return randomNum;
  }

  const handleContinue = () => {
    const formIsValid = selected && level;
if (!formIsValid) return;
    // Validate form input first...
    if (formIsValid) {
      const chatSessionId = generateChatSessionId();
      
      navigate('/chat', {
        state: {
      chatSessionId,
    },
        // pass any other props you need
      });
    } else {
      alert('Please complete all required fields.');
    }
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-slate-950 via-slate-925 to-slate-900 text-slate-100 flex items-center justify-center p-6">
      {/* Simple top-right sign out button */}
      <div style={{ position: "absolute", top: 16, right: 16 }}>
        <button
          onClick={async () => {
            await supabase.auth.signOut();
            navigate("/login", { replace: true });
          }}
          style={{
            background: "#f44",
            color: "white",
            border: "none",
            padding: "6px 12px",
            borderRadius: "8px",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Sign out
        </button>
      </div>

      <div className="w-full max-w-3xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Choose your learning language
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Pick a language and level. You can change this later in settings.
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="mb-4">
          <div className="relative">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search languages… (e.g., Spanish, Español, es)"
              className="w-full rounded-2xl bg-slate-900/70 border border-slate-800/80 focus:border-emerald-500/70 outline-none px-4 py-3 text-sm placeholder:text-slate-500"
            />
            <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-500">
              ⌘K
            </div>
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {filtered.map((lang) => {
            const active = selected?.code === lang.code;
            return (
              <button
                key={lang.code}
                onClick={() => setSelected(lang)}
                className={`group relative rounded-2xl border p-3 text-left transition-all ${
                  active
                    ? "border-emerald-500/70 bg-emerald-500/10 shadow-[0_10px_30px_-15px_rgba(16,185,129,0.6)]"
                    : "border-slate-800 bg-slate-900/50 hover:border-slate-700 hover:bg-slate-900/70"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xl leading-none select-none">{lang.flag}</span>
                  <div>
                    <div className="text-sm font-semibold">{lang.name}</div>
                    <div className="text-xs text-slate-400">
                      {lang.native} • {lang.code}
                    </div>
                  </div>
                </div>
                {active && (
                  <div className="absolute right-3 top-3 text-emerald-400 text-xs font-semibold">
                    Selected
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Level + Continue */}
        <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Level:</span>
            <div className="inline-flex rounded-xl border border-slate-800 overflow-hidden">
              {LEVELS.map((lv) => (
                <button
                  key={lv.id}
                  onClick={() => setLevel(lv.id)}
                  className={`px-3 py-1.5 text-xs font-medium ${
                    level === lv.id
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-900 text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  {lv.label}
                </button>
              ))}
            </div>
          </div>

          <div className="sm:ml-auto flex items-center gap-2">
            {selected ? (
              <div className="text-xs text-slate-300">
                Selected: <span className="font-semibold">{selected.name}</span>{" "}
                • <span className="uppercase">{level}</span>
              </div>
            ) : (
              <div className="text-xs text-slate-500">Select a language to continue</div>
            )}
            <button
              onClick={handleContinue}
              disabled={!selected}
              className="relative inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
            >
              <span className="absolute inset-0 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500" />
              <span className="absolute -inset-px rounded-2xl blur-md bg-gradient-to-br from-emerald-500/40 to-teal-500/40" />
              <span className="relative">Continue</span>
            </button>
          </div>
        </div>

        {/* Tiny footnote */}
        <div className="mt-4 text-[11px] text-slate-500">
          Tip: Press{" "}
          <kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700">
            ⌘K
          </kbd>{" "}
          to focus the search box.
        </div>
      </div>
    </div>
  );
}