// Voices via the browser's built-in speechSynthesis (no API key, no backend).
// Spanish by default; English replies from Mateo get an English voice.
const synth = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;

export const speechSupported = Boolean(synth);

const PREFERRED = { es: "es-ES", en: "en-US" };

let voicesPromise = null;
let generation = 0; // bumped by stop/speak so a stale speak() call (still waiting for voices) never starts

function loadVoices() {
  if (!synth) return Promise.resolve([]);
  if (voicesPromise) return voicesPromise;
  voicesPromise = new Promise((resolve) => {
    const now = synth.getVoices();
    if (now.length) return resolve(now);
    synth.addEventListener("voiceschanged", () => resolve(synth.getVoices()), { once: true });
    setTimeout(() => resolve(synth.getVoices()), 2000); // some browsers never fire voiceschanged
  }).then((list) => {
    if (!list.length) voicesPromise = null; // try again next time instead of caching "no voices"
    return list;
  });
  return voicesPromise;
}

function pickVoice(voices, lang) {
  return (
    voices.find((v) => v.lang === PREFERRED[lang]) ||
    voices.find((v) => v.lang?.toLowerCase().startsWith(lang)) ||
    null
  );
}

/**
 * Speak text. `lang` is "es" (default) or "en"; `rate` < 1 is slower.
 * Calls onEnd when finished, stopped, or failed.
 */
export async function speak(text, { onEnd, rate = 0.95, lang = "es" } = {}) {
  if (!synth || !text) return onEnd?.();
  synth.cancel();
  const mine = ++generation;
  const voice = pickVoice(await loadVoices(), lang);
  if (mine !== generation) return onEnd?.(); // stopped or superseded while loading voices
  const utterance = new SpeechSynthesisUtterance(text);
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang || PREFERRED[lang] || PREFERRED.es;
  utterance.rate = rate;
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();
  synth.speak(utterance);
}

export function stopSpeaking() {
  generation++;
  synth?.cancel();
}
