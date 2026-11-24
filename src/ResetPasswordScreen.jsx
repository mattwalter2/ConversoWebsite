import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "./supaBaseClient";
import "./LoginScreen.css";

export default function ResetPasswordScreen({ session }) {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    if (password.length < 8) return setErr("Use at least 8 characters.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setErr(error.message);
    setDone(true);
  }

  return (
    <div className="cv-auth">
      <div className="cv-auth__card cv-auth__card--single">
        <main className="cv-auth__form">
          <h2 className="cv-form__title">Choose a new password</h2>
          {!session ? (
            <>
              <div className="cv-error">This reset link has expired or was already used. Request a new one from the login page.</div>
              <button className="cv-button" onClick={() => navigate("/")}>Back to login</button>
            </>
          ) : done ? (
            <>
              <div className="cv-notice">Password updated. You're signed in.</div>
              <button className="cv-button cv-button--primary" onClick={() => navigate("/profile")}>Continue</button>
            </>
          ) : (
            <form className="cv-form" onSubmit={onSubmit}>
              {err && <div className="cv-error" role="alert">{err}</div>}
              <label className="cv-field">
                <span className="cv-label">New password</span>
                <input
                  type="password"
                  className="cv-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>
              <button className="cv-button cv-button--primary" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save password"}
              </button>
            </form>
          )}
        </main>
      </div>
    </div>
  );
}
