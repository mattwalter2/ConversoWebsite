// src/App.jsx
import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import { supabase } from "./supaBaseClient"; // adjust path if needed
import SelectLanguageScreen from "./SelectLanguageScreen";
import LoginScreen from "./LoginScreen";
import ChatScreen from "./ChatScreen"; // <-- import your chat component
import ProfileScreen from "./ProfileScreen";

// Gate for auth-only routes
function ProtectedRoute({ session, children }) {
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

// Pull saved language from localStorage
function getStoredLang() {
  try {
    const raw = localStorage.getItem("converso.lang");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Wrap Chat to inject the stored language (and guard if missing)
function ChatRoute() {
  const lang = getStoredLang();
  if (!lang) return <Navigate to="/select" replace />;
  return <ChatScreen lang={lang.name || "Spanish"} />;
}

export default function App() {
  // --- Supabase example block with a loading guard
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);
  // --- end block

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;

  // Not signed in → show your login screen
  if (!session) {
    return <LoginScreen />;
  }

  // Signed in → app router
  return (
    <BrowserRouter>
      <Routes>
        {/* Default to /select when authed */}
        <Route path="/" element={<Navigate to="/profile" replace />} />

        {/* Keep /login for completeness: authed users bounce */}
        <Route path="/login" element={<Navigate to="/select" replace />} />

        {/* Language selection */}
        <Route
          path="/select"
          element={
            <ProtectedRoute session={session}>
              <SelectLanguageScreen />
            </ProtectedRoute>
          }
        />

        {/* NEW: Chat route (requires selected language) */}
        <Route
          path="/chat"
          element={
            <ProtectedRoute session={session}>
              <ChatScreen />
            </ProtectedRoute>
          }
        />


        <Route
          path="/profile"
          element={
            <ProtectedRoute session={session}>
              <ProfileScreen />
            </ProtectedRoute>
          }
        />
        {/* Fallback */}
        <Route path="*" element={<Navigate to="/select" replace />} />
      </Routes>
    </BrowserRouter>
  );
}