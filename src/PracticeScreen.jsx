import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./PracticeScreen.css";
import TopBar from "./TopBar";
import { getProfile, getTopicRatings, startSession, updateProfile } from "./api";
import { CORRECTION_OPTIONS, DIFFICULTY_OPTIONS, TOPICS, levelName } from "./spanish";

export default function PracticeScreen() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [topic, setTopic] = useState("general");
  const [error, setError] = useState("");
  const [topicRatings, setTopicRatings] = useState({});
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    getProfile()
      .then(setProfile)
      .catch((e) => setError(e.message));
    getTopicRatings().then(setTopicRatings).catch(() => {});
  }, []);

  async function saveSetting(field, value) {
    setError("");
    const prev = profile;
    setProfile({ ...profile, [field]: value }); // optimistic
    try {
      setProfile(await updateProfile({ [field]: value }));
    } catch (e) {
      setProfile(prev);
      setError(e.message);
    }
  }

  async function onStart() {
    setError("");
    setStarting(true);
    try {
      const session = await startSession(topic);
      navigate(`/chat/${session.id}`);
    } catch (e) {
      setError(e.message);
      setStarting(false);
    }
  }

  return (
    <div className="cv-page">
      <TopBar />

      <div className="cv-container pr">
        <div className="pr-head">
          <h1 className="cv-h1">¿De qué hablamos hoy?</h1>
          <p className="cv-muted">Pick a topic and start chatting with Mateo in Spanish.</p>
          {profile && (
            <p className="cv-small cv-muted">
              Your Elo: <strong className="pr-elo">{profile.overall_elo}</strong> · {levelName(profile.overall_elo)}
            </p>
          )}
        </div>

        {error && <div className="cv-error">{error}</div>}

        <section className="cv-card">
          <h2 className="cv-card__title">Topic</h2>
          <div className="pr-topics">
            {TOPICS.map((t) => (
              <button
                key={t.key}
                className={`pr-topic ${topic === t.key ? "is-active" : ""}`}
                onClick={() => setTopic(t.key)}
              >
                <span className="pr-topic__emoji" aria-hidden>{t.emoji}</span>
                <span className="pr-topic__label">{t.label}</span>
                <span className="pr-topic__blurb">{t.blurb}</span>
                <span className="pr-topic__elo">{topicRatings[t.key] ? `Your Elo here: ${topicRatings[t.key].elo}` : "New topic"}</span>
              </button>
            ))}
          </div>
        </section>

        {profile && (
          <section className="cv-card pr-settings">
            <div className="pr-setting">
              <div>
                <div className="pr-setting__label">Corrections</div>
                <div className="cv-small cv-muted">
                  {CORRECTION_OPTIONS.find((o) => o.id === profile.correction_frequency)?.hint}
                </div>
              </div>
              <div className="cv-segment">
                {CORRECTION_OPTIONS.map((o) => (
                  <button
                    key={o.id}
                    className={profile.correction_frequency === o.id ? "is-active" : ""}
                    onClick={() => saveSetting("correction_frequency", o.id)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="pr-setting">
              <div>
                <div className="pr-setting__label">Difficulty</div>
                <div className="cv-small cv-muted">
                  {DIFFICULTY_OPTIONS.find((o) => o.id === profile.difficulty_mode)?.hint}
                </div>
              </div>
              <div className="cv-segment">
                {DIFFICULTY_OPTIONS.map((o) => (
                  <button
                    key={o.id}
                    className={profile.difficulty_mode === o.id ? "is-active" : ""}
                    onClick={() => saveSetting("difficulty_mode", o.id)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        <div className="pr-start">
          <button
            className="cv-btn cv-btn--primary cv-btn--lg"
            onClick={onStart}
            disabled={!profile || starting}
          >
            {starting ? <><span className="cv-spinner" /> Starting…</> : "Empezar · Start chatting"}
          </button>
        </div>
      </div>
    </div>
  );
}
