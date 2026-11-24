import { useState } from "react";
import "./LoginScreen.css";
import { supabase } from "./supaBaseClient";

// Google sign-in needs the Google provider configured in Supabase first; set VITE_GOOGLE_AUTH=on once it is.
const GOOGLE_AUTH = import.meta.env.VITE_GOOGLE_AUTH === "on";

export default function LoginScreen() {
  const [tab, setTab] = useState("login"); // "login" | "signup"

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [name, setName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");

  const switchTab = (next) => {
    setTab(next);
    setErr("");
    setNotice("");
  };

  async function handleLogin(e) {
    e.preventDefault();
    setErr("");
    setNotice("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail.trim(),
      password: loginPassword,
    });
    setLoading(false);
    if (error) setErr(error.message);
    // On success App's auth listener swaps to the signed-in routes.
  }

  async function handleSignup(e) {
    e.preventDefault();
    setErr("");
    setNotice("");
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: signupEmail.trim(),
      password: signupPassword,
      options: {
        data: { name: name.trim() }, // seeds the profile (DB trigger); Elo starts at the default and adapts
        emailRedirectTo: window.location.origin,
      },
    });
    setLoading(false);
    if (error) return setErr(error.message);
    if (!data.session) {
      setNotice("Check your email to confirm your account, then log in.");
      setTab("login");
      setLoginEmail(signupEmail.trim());
    }
  }

  async function handleForgot(e) {
    e.preventDefault();
    setErr("");
    setNotice("");
    if (!loginEmail.trim()) return setErr("Enter your email first.");
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(loginEmail.trim(), {
      redirectTo: window.location.origin + "/reset-password",
    });
    setLoading(false);
    if (error) setErr(error.message);
    else setNotice("Password reset email sent. Check your inbox.");
  }

  async function handleGoogle() {
    setErr("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    setLoading(false);
    if (error) setErr(error.message);
  }

  return (
    <div className="cv-auth">
      <div className="cv-auth__card">
        <aside className="cv-auth__brand">
          <div className="cv-brand__badge">C</div>
          <h1 className="cv-brand__title">Converso</h1>
          <p className="cv-brand__subtitle">Aprende español conversando. Learn Spanish by chatting.</p>

          <ul className="cv-brand__points">
            <li>Chat with Mateo, your Spanish tutor from Barcelona</li>
            <li>Gentle corrections as you go</li>
            <li>Difficulty that adapts to your Elo</li>
            <li>A report and Elo update after every session</li>
          </ul>

          <div className="cv-brand__footer">
            <span className="cv-brand__dot" /> 🇪🇸 Spanish
          </div>
        </aside>

        <main className="cv-auth__form">
          <div className="cv-tabs" role="tablist" aria-label="Authentication tabs">
            <button
              role="tab"
              aria-selected={tab === "login"}
              className={`cv-tab ${tab === "login" ? "is-active" : ""}`}
              onClick={() => switchTab("login")}
            >
              Log in
            </button>
            <button
              role="tab"
              aria-selected={tab === "signup"}
              className={`cv-tab ${tab === "signup" ? "is-active" : ""}`}
              onClick={() => switchTab("signup")}
            >
              Sign up
            </button>
          </div>

          {err && <div className="cv-error" role="alert">{err}</div>}
          {notice && <div className="cv-notice" role="status">{notice}</div>}

          {tab === "login" ? (
            <form className="cv-form" aria-labelledby="login-title" onSubmit={handleLogin}>
              <h2 id="login-title" className="cv-form__title">¡Bienvenido de nuevo!</h2>

              <label className="cv-field">
                <span className="cv-label">Email</span>
                <input
                  type="email"
                  className="cv-input"
                  placeholder="you@example.com"
                  autoComplete="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  required
                />
              </label>

              <label className="cv-field">
                <span className="cv-label">Password</span>
                <input
                  type="password"
                  className="cv-input"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                />
              </label>

              <div className="cv-form__row cv-form__row--end">
                <button type="button" className="cv-link cv-link--button" onClick={handleForgot} disabled={loading}>
                  Forgot password?
                </button>
              </div>

              <button className="cv-button cv-button--primary" type="submit" disabled={loading}>
                {loading ? "Please wait…" : "Log in"}
              </button>

              {GOOGLE_AUTH && (
                <>
                  <div className="cv-divider"><span>or</span></div>
                  <button className="cv-button cv-button--ghost" type="button" disabled={loading} onClick={handleGoogle}>
                    <GoogleIcon /> Continue with Google
                  </button>
                </>
              )}

              <p className="cv-hint">
                New to Converso?{" "}
                <button className="cv-link cv-link--button" type="button" onClick={() => switchTab("signup")}>
                  Create an account
                </button>
              </p>
            </form>
          ) : (
            <form className="cv-form" aria-labelledby="signup-title" onSubmit={handleSignup}>
              <h2 id="signup-title" className="cv-form__title">Create your account</h2>

              <label className="cv-field">
                <span className="cv-label">Name</span>
                <input
                  type="text"
                  className="cv-input"
                  placeholder="Jane Doe"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </label>

              <label className="cv-field">
                <span className="cv-label">Email</span>
                <input
                  type="email"
                  className="cv-input"
                  placeholder="you@example.com"
                  autoComplete="email"
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  required
                />
              </label>

              <label className="cv-field">
                <span className="cv-label">Password</span>
                <input
                  type="password"
                  className="cv-input"
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  minLength={8}
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  required
                />
              </label>

              <button className="cv-button cv-button--primary" type="submit" disabled={loading}>
                {loading ? "Please wait…" : "Sign up"}
              </button>

              {GOOGLE_AUTH && (
                <>
                  <div className="cv-divider"><span>or</span></div>
                  <button className="cv-button cv-button--ghost" type="button" disabled={loading} onClick={handleGoogle}>
                    <GoogleIcon /> Sign up with Google
                  </button>
                </>
              )}

              <p className="cv-hint">
                Already have an account?{" "}
                <button className="cv-link cv-link--button" type="button" onClick={() => switchTab("login")}>
                  Log in
                </button>
              </p>
            </form>
          )}
        </main>
      </div>

      <footer className="cv-auth__legal">© {new Date().getFullYear()} Converso</footer>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="cv-icon" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
