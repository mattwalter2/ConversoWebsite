// Thin wrappers around Supabase: Edge Functions for anything that changes scores,
// direct RLS-protected table access for reads and profile settings.
import { supabase } from "./supaBaseClient";
import { dayStreak } from "../supabase/functions/_shared/streak.ts";

async function invoke(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    try {
      const payload = await error.context?.json();
      if (payload?.error) message = payload.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message || "Request failed");
  }
  return data;
}

/** Create a new practice session for a topic. Returns the session row. */
export async function startSession(topic) {
  const { session } = await invoke("session-start", { topic });
  return session;
}

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

function parseSseEvent(raw) {
  let event = "message";
  const data = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  try {
    return { event, data: JSON.parse(data.join("\n")) };
  } catch {
    return { event, data: {} };
  }
}

/**
 * Send one learner message and stream Mateo's reply. `onDelta(text)` gets the reply as it's
 * written (a preview); resolves with the saved [userMessageRow, tutorMessageRow].
 */
export async function sendMessageStream(sessionId, message, { onDelta } = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");

  const res = await fetch(`${FUNCTIONS_URL}/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ session_id: sessionId, message }),
  });
  if (!res.ok || !res.body) {
    let errorMessage = `Request failed (${res.status})`;
    try {
      const payload = await res.json();
      if (payload?.error) errorMessage = payload.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(errorMessage);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const { event, data: payload } = parseSseEvent(buffer.slice(0, end));
      buffer = buffer.slice(end + 2);
      if (event === "delta" && payload.text) onDelta?.(payload.text);
      else if (event === "done") return payload.messages;
      else if (event === "error") throw new Error(payload.error || "Something went wrong. Please try again.");
    }
  }
  throw new Error("The connection dropped before Mateo finished. Please try again.");
}

/** Signed URL (valid ~1 h) for Mateo's natural-voice audio of one of his messages. */
export async function getTutorAudioUrl(messageId) {
  const { url } = await invoke("tts", { message_id: messageId });
  return url;
}

// Keep in sync with MAX_AUDIO_BYTES in supabase/functions/_shared/voice.ts (gateway drops >~5 MB).
export const MAX_RECORDING_BYTES = 4 * 1024 * 1024;

/** Transcribe a recorded clip of the learner speaking. Returns the text (mistakes kept). */
export async function transcribeAudio(blob) {
  if (blob.size > MAX_RECORDING_BYTES) throw new Error("That recording is too long. Keep it under a minute.");
  const form = new FormData();
  form.append("audio", blob, "speech");
  const { text } = await invoke("transcribe", form);
  return text;
}

/** English meaning of one word in one of Mateo's messages: { translation, note }. */
export function translateWord(messageId, word) {
  return invoke("translate", { mode: "word", message_id: messageId, word });
}

/** English translation of a whole tutor message (cached server-side on the message). */
export async function translateMessage(messageId) {
  const { translation } = await invoke("translate", { mode: "message", message_id: messageId });
  return translation;
}

/** Finish a session. Returns { report, profile } (report is null if nothing was said). */
export function completeSession(sessionId) {
  return invoke("session-complete", { session_id: sessionId });
}

async function currentUserId() {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user?.id;
  if (!id) throw new Error("Not signed in");
  return id;
}

export async function getProfile() {
  const id = await currentUserId();
  const { data, error } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

/** Only display_name, avatar_url, correction_frequency, difficulty_mode (and level) are writable. */
export async function updateProfile(fields) {
  const id = await currentUserId();
  const { data, error } = await supabase.from("profiles").update(fields).eq("id", id).select("*").single();
  if (error) throw error;
  return data;
}

/** Session + transcript. A finished session also gets `new_elo` (overall Elo right after it). */
export async function getSessionWithMessages(sessionId) {
  const [s, m, h] = await Promise.all([
    supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle(),
    supabase.from("messages").select("*").eq("session_id", sessionId).order("id", { ascending: true }),
    supabase.from("elo_history").select("new_elo").eq("session_id", sessionId).eq("area", "overall").maybeSingle(),
  ]);
  if (s.error) throw s.error;
  if (m.error) throw m.error;
  if (h.error) throw h.error;
  const session = s.data ? { ...s.data, new_elo: h.data?.new_elo ?? null } : null;
  return { session, messages: m.data ?? [] };
}

export async function getEloHistory() {
  const { data, error } = await supabase
    .from("elo_history")
    .select("area, new_elo, delta, created_at, session_id")
    .eq("area", "overall")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getCompletedSessions(limit = 50) {
  const { data, error } = await supabase
    .from("sessions")
    .select("id, topic, started_at, ended_at, summary, overall_delta, accuracy, new_words")
    .eq("status", "completed")
    .order("ended_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** Everything Mateo remembers about the learner (facts + recurring mistakes), most-seen first. */
export async function getMemory() {
  const { data, error } = await supabase
    .from("learner_memory")
    .select("id, kind, content, times_seen, last_seen_at")
    .order("times_seen", { ascending: false })
    .order("last_seen_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function forgetMemory(id) {
  const { error } = await supabase.from("learner_memory").delete().eq("id", id);
  if (error) throw error;
}

export async function forgetAllMemory() {
  const id = await currentUserId();
  const { error } = await supabase.from("learner_memory").delete().eq("user_id", id);
  if (error) throw error;
}

/** Top-bar numbers: day streak (from finished sessions) and flashcards due now. */
export async function getProgressSummary() {
  const since = new Date(Date.now() - 400 * 86_400_000).toISOString();
  const [s, d] = await Promise.all([
    supabase.from("sessions").select("ended_at").eq("status", "completed").gte("ended_at", since),
    supabase.from("user_words").select("id", { count: "exact", head: true }).lte("due_at", new Date().toISOString()),
  ]);
  if (s.error) throw s.error;
  if (d.error) throw d.error;
  return { streak: dayStreak((s.data ?? []).map((r) => r.ended_at)), due: d.count ?? 0 };
}

/** All flashcards, soonest due first. */
export async function getWords() {
  const { data, error } = await supabase.from("user_words").select("*").order("due_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Save a review: only the scheduling fields are writable. */
export async function reviewWord(id, s) {
  const { reps, interval_days, ease, lapses, due_at, last_reviewed_at } = s;
  const { error } = await supabase.from("user_words").update({ reps, interval_days, ease, lapses, due_at, last_reviewed_at }).eq("id", id);
  if (error) throw error;
}

export async function forgetWord(id) {
  const { error } = await supabase.from("user_words").delete().eq("id", id);
  if (error) throw error;
}

/** Elo per topic: { [topic]: { elo, sessions } }. */
export async function getTopicRatings() {
  const { data, error } = await supabase.from("topic_ratings").select("topic, elo, sessions");
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.topic, r]));
}

export async function signOut() {
  await supabase.auth.signOut();
}

/** Same shape the session-complete function returns, rebuilt from a stored session row. */
export function reportFromSession(session) {
  return {
    overallDelta: session.overall_delta ?? 0,
    skillDeltas: session.skill_deltas ?? {},
    accuracy: session.accuracy,
    summary: session.summary,
    strengths: session.strengths ?? [],
    improvements: session.improvements ?? [],
    newWords: session.new_words ?? [],
    placement: session.placement ?? null,
  };
}
