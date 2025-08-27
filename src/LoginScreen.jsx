import React, { useState } from "react";
import "./LoginScreen.css";
import { supabase } from "./supaBaseClient";

export default function LoginScreen({ onAuthed }) {
  const [tab, setTab] = useState("login"); // "login" | "signup"

  // login form state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // signup form state
  const [name, setName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [targetLang, setTargetLang] = useState("Spanish");

  // ui state
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function handleLogin(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail.trim(),
      password: loginPassword,
    });
    setLoading(false);
    if (error) return setErr(error.message);
    onAuthed?.(data.session); // optional: navigate to app
  }

  async function handleSignup(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: signupEmail.trim(),
      password: signupPassword,
      options: {
        data: { name, targetLang }, // stored in auth.user.user_metadata
        emailRedirectTo: window.location.origin, // optional: where email verify lands
      },
    });
    setLoading(false);
    if (error) return setErr(error.message);

    // If email confirmations are ON, user must verify via email.
    // If OFF, you'll already have a session in data.session.
    onAuthed?.(data.session ?? null);
  }

  return (
    <div className="cv-auth">
      <div className="cv-auth__card">
        {/* Left panel / brand */}
        <aside className="cv-auth__brand">
          <div className="cv-brand__badge">C</div>
          <h1 className="cv-brand__title">Converso</h1>
          <p className="cv-brand__subtitle">Learn by chatting. Level up daily.</p>

          <ul className="cv-brand__points">
            <li>Adaptive ELO difficulty</li>
            <li>Topic-focused practice</li>
            <li>Real-time feedback</li>
          </ul>

          <div className="cv-brand__footer">
            <span className="cv-brand__dot" /> Secure by design
          </div>
        </aside>

        {/* Right panel / form */}
        <main className="cv-auth__form">
          {/* Tabs */}
          <div className="cv-tabs" role="tablist" aria-label="Authentication tabs">
            <button
              role="tab"
              aria-selected={tab === "login"}
              className={`cv-tab ${tab === "login" ? "is-active" : ""}`}
              onClick={() => setTab("login")}
            >
              Log in
            </button>
            <button
              role="tab"
              aria-selected={tab === "signup"}
              className={`cv-tab ${tab === "signup" ? "is-active" : ""}`}
              onClick={() => setTab("signup")}
            >
              Sign up
            </button>
          </div>

          {err && <div className="cv-error" role="alert">{err}</div>}

          {/* Forms */}
          {tab === "login" ? (
            <form className="cv-form" aria-labelledby="login-title" onSubmit={handleLogin}>
              <h2 id="login-title" className="cv-form__title">Welcome back</h2>

              <label className="cv-field">
                <span className="cv-label">Email</span>
                <input
                  type="email"
                  className="cv-input"
                  placeholder="you@example.com"
                  value={loginEmail}
                  onChange={(e)=>setLoginEmail(e.target.value)}
                  required
                />
              </label>

              <label className="cv-field">
                <span className="cv-label">Password</span>
                <input
                  type="password"
                  className="cv-input"
                  placeholder="••••••••"
                  value={loginPassword}
                  onChange={(e)=>setLoginPassword(e.target.value)}
                  required
                />
              </label>

              <div className="cv-form__row">
                <label className="cv-check">
                  <input type="checkbox" /> <span>Remember me</span>
                </label>
                <a
                  href="#"
                  className="cv-link"
                  onClick={async (e) => {
                    e.preventDefault();
                    setErr("");
                    if (!loginEmail) return setErr("Enter your email first.");
                    setLoading(true);
                    const { error } = await supabase.auth.resetPasswordForEmail(loginEmail, {
                      redirectTo: window.location.origin + "/reset-password",
                    });
                    setLoading(false);
                    if (error) setErr(error.message);
                    else alert("Password reset email sent.");
                  }}
                >
                  Forgot password?
                </a>
              </div>

              <button className="cv-button cv-button--primary" type="submit" disabled={loading}>
                {loading ? "Please wait…" : "Log in"}
              </button>

              <div className="cv-divider"><span>or</span></div>

              <div className="cv-socials">
                <button
                  className="cv-button cv-button--ghost"
                  type="button"
                  disabled={loading}
                  onClick={async ()=>{
                    setErr("");
                    setLoading(true);
                    const { data, error } = await supabase.auth.signInWithOAuth({
                      provider: "google",
                      options: { redirectTo: window.location.origin }
                    });
                    setLoading(false);
                    if (error) setErr(error.message);
                    // On success, Supabase will redirect; no local onAuthed call here.
                  }}
                >
                  <span className="cv-icon">🔵</span> Continue with Google
                </button>

                <button className="cv-button cv-button--ghost" type="button" disabled>
                  <span className="cv-icon">💼</span> Continue with Microsoft
                </button>
              </div>

              <p className="cv-hint">
                New to Converso?{" "}
                <button className="cv-link cv-link--button" type="button" onClick={() => setTab("signup")}>
                  Create an account
                </button>
              </p>
            </form>
          ) : (
            <form className="cv-form" aria-labelledby="signup-title" onSubmit={handleSignup}>
              <h2 id="signup-title" className="cv-form__title">Create your account</h2>

              <label className="cv-field">
                <span className="cv-label">Full name</span>
                <input
                  type="text"
                  className="cv-input"
                  placeholder="Jane Doe"
                  value={name}
                  onChange={(e)=>setName(e.target.value)}
                  required
                />
              </label>

              <label className="cv-field">
                <span className="cv-label">Email</span>
                <input
                  type="email"
                  className="cv-input"
                  placeholder="you@example.com"
                  value={signupEmail}
                  onChange={(e)=>setSignupEmail(e.target.value)}
                  required
                />
              </label>

              <label className="cv-field">
                <span className="cv-label">Password</span>
                <input
                  type="password"
                  className="cv-input"
                  placeholder="Create a password"
                  value={signupPassword}
                  onChange={(e)=>setSignupPassword(e.target.value)}
                  required
                />
              </label>

              <label className="cv-field">
                <span className="cv-label">Target language</span>
                <select
                  className="cv-input"
                  value={targetLang}
                  onChange={(e)=>setTargetLang(e.target.value)}
                >
                  <option>Spanish</option>
                  <option>French</option>
                  <option>German</option>
                  <option>Italian</option>
                </select>
              </label>

              <label className="cv-check cv-check--terms">
                <input type="checkbox" required />{" "}
                <span>
                  I agree to the <a href="#" className="cv-link">Terms</a> and{" "}
                  <a href="#" className="cv-link">Privacy</a>.
                </span>
              </label>

              <button className="cv-button cv-button--primary" type="submit" disabled={loading}>
                {loading ? "Please wait…" : "Sign up"}
              </button>

              <div className="cv-divider"><span>or</span></div>

              <div className="cv-socials">
                <button
                  className="cv-button cv-button--ghost"
                  type="button"
                  disabled={loading}
                  onClick={async ()=>{
                    setErr("");
                    setLoading(true);
                    const { data, error } = await supabase.auth.signInWithOAuth({
                      provider: "google",
                      options: { redirectTo: window.location.origin }
                    });
                    setLoading(false);
                    if (error) setErr(error.message);
                  }}
                >
                  <span className="cv-icon">🔵</span> Sign up with Google
                </button>
                <button className="cv-button cv-button--ghost" type="button" disabled>
                  <span className="cv-icon">💼</span> Sign up with Microsoft
                </button>
              </div>

              <p className="cv-hint">
                Already have an account?{" "}
                <button className="cv-link cv-link--button" type="button" onClick={() => setTab("login")}>
                  Log in
                </button>
              </p>
            </form>
          )}
        </main>
      </div>

      <footer className="cv-auth__legal">
        © {new Date().getFullYear()} Converso • <a href="#" className="cv-link">Privacy</a> • <a href="#" className="cv-link">Terms</a>
      </footer>
    </div>
  );
}