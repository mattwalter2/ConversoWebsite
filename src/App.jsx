import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { supabase } from "./supaBaseClient";
import LoginScreen from "./LoginScreen";
import ResetPasswordScreen from "./ResetPasswordScreen";
import ProfileScreen from "./ProfileScreen";
import PracticeScreen from "./PracticeScreen";
import ChatScreen from "./ChatScreen";
import WordsScreen from "./WordsScreen";

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (loading) return <div className="cv-loading">Cargando…</div>;

  return (
    <BrowserRouter>
      <Routes>
        {/* Reachable from the password-reset email link (Supabase signs the user in first). */}
        <Route path="/reset-password" element={<ResetPasswordScreen session={session} />} />

        {session ? (
          <>
            <Route path="/" element={<Navigate to="/profile" replace />} />
            <Route path="/profile" element={<ProfileScreen />} />
            <Route path="/practice" element={<PracticeScreen />} />
            <Route path="/chat/:sessionId" element={<ChatScreen />} />
            <Route path="/words" element={<WordsScreen />} />
            <Route path="*" element={<Navigate to="/profile" replace />} />
          </>
        ) : (
          <Route path="*" element={<LoginScreen />} />
        )}
      </Routes>
    </BrowserRouter>
  );
}
