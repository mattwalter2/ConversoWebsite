// Spanish-specific content: topics, levels, skills, tutor settings.
// Topic keys must match supabase/functions/_shared/prompts.ts TOPICS.

export const TOPICS = [
  {
    key: "general",
    label: "General chat",
    emoji: "💬",
    blurb: "Get to know Mateo and talk about your day.",
    starters: ["¡Hola Mateo! ¿Qué tal?", "Hoy tengo mucho trabajo, pero estoy bien."],
  },
  {
    key: "restaurant",
    label: "Restaurant",
    emoji: "🍽️",
    blurb: "Book a table, order tapas, ask for the bill.",
    starters: ["Hola, quiero reservar una mesa para dos.", "¿Qué me recomienda del menú?"],
  },
  {
    key: "travel",
    label: "Travel",
    emoji: "✈️",
    blurb: "Airports, hotels, directions and sightseeing.",
    starters: ["Perdón, ¿dónde está la estación de tren?", "Tengo una reserva en este hotel."],
  },
  {
    key: "work",
    label: "Work",
    emoji: "💼",
    blurb: "Your job, meetings and interview practice.",
    starters: ["Trabajo como ingeniero en una empresa pequeña.", "Mañana tengo una entrevista de trabajo."],
  },
  {
    key: "social",
    label: "Social",
    emoji: "🎉",
    blurb: "Plans with friends, family and catching up.",
    starters: ["¿Quieres ir al cine este fin de semana?", "Ayer fui a una fiesta con mis amigos."],
  },
  {
    key: "hobbies",
    label: "Hobbies",
    emoji: "🎸",
    blurb: "Sports, music, films, food and weekends.",
    starters: ["Me gusta mucho jugar al fútbol.", "¿Qué música te gusta escuchar?"],
  },
];

export const topicOf = (key) => TOPICS.find((t) => t.key === key) ?? TOPICS[0];

// Learners never pick a level: everyone starts at the default Elo and it adapts after each session.
export function levelName(elo) {
  if (elo < 400) return "Novice";
  if (elo < 800) return "Beginner";
  if (elo < 1200) return "Intermediate";
  if (elo < 1600) return "Upper-intermediate";
  if (elo < 2000) return "Advanced";
  return "Near-native";
}

export const SKILLS = [
  { key: "conversation", label: "Conversation" },
  { key: "grammar", label: "Grammar" },
  { key: "vocabulary", label: "Vocabulary" },
  { key: "comprehension", label: "Comprehension" },
  { key: "fluency", label: "Fluency" },
];

export const CORRECTION_OPTIONS = [
  { id: "off", label: "Off", hint: "Just chat, no corrections" },
  { id: "minimal", label: "Minimal", hint: "Only mistakes that block understanding" },
  { id: "normal", label: "Normal", hint: "Mistakes worth learning from" },
  { id: "strict", label: "Strict", hint: "Everything, including accents" },
];

export const DIFFICULTY_OPTIONS = [
  { id: "easy", label: "Easier", hint: "Simpler Spanish to build confidence" },
  { id: "adaptive", label: "Adaptive", hint: "Matched to your level" },
  { id: "challenge", label: "Challenge", hint: "Harder Spanish to stretch you" },
];

export const ACCENT_KEYS = ["á", "é", "í", "ó", "ú", "ñ", "ü", "¿", "¡"];
