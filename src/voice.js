// Mateo's natural voice (Google Chirp 3 HD via the `tts` function), with the browser's
// built-in speech as a fallback when it isn't set up or fails.
import { getTutorAudioUrl } from "./api";
import { speak, stopSpeaking } from "./speech";

const URL_REUSE_MS = 50 * 60 * 1000; // signed URLs last 60 min
const urlCache = new Map(); // messageId -> { url, at }
let current = null;
let generation = 0;

async function audioUrl(messageId) {
  const hit = urlCache.get(messageId);
  if (hit && Date.now() - hit.at < URL_REUSE_MS) return hit.url;
  const url = await getTutorAudioUrl(messageId);
  urlCache.set(messageId, { url, at: Date.now() });
  return url;
}

/** Play one of Mateo's messages. `slow` plays at 0.75x. Calls onEnd when finished, stopped, or failed. */
export async function playTutorMessage(message, { slow = false, onEnd } = {}) {
  stopTutorAudio();
  const mine = ++generation;
  try {
    const url = await audioUrl(message.id);
    if (mine !== generation) return onEnd?.();
    const audio = new Audio(url);
    audio.playbackRate = slow ? 0.75 : 1;
    audio.preservesPitch = true;
    audio.onended = () => onEnd?.();
    audio.onerror = () => onEnd?.();
    current = audio;
    await audio.play();
  } catch (err) {
    if (mine !== generation) return onEnd?.();
    console.warn("[converso] natural voice unavailable, using the browser voice:", err?.message ?? err);
    speak(message.content, { lang: message.language === "en" ? "en" : "es", rate: slow ? 0.7 : 0.95, onEnd });
  }
}

export function stopTutorAudio() {
  generation++;
  if (current) {
    current.pause();
    current = null;
  }
  stopSpeaking();
}
