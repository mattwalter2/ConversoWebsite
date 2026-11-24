// Microphone recording for talking to Mateo (MediaRecorder; webm/opus in Chrome, mp4 in Safari).
export const micSupported =
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== "undefined";

const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

/**
 * Start recording. Returns { stop(): Promise<Blob>, cancel() }. `onLimit` fires when the
 * clip reaches `maxMs` so the caller can stop and send it.
 */
export async function startRecording({ maxMs = 60_000, onLimit } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((resolve) => {
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" }));
    };
  });
  recorder.start();
  const timer = setTimeout(() => onLimit?.(), maxMs);

  return {
    stop() {
      clearTimeout(timer);
      if (recorder.state !== "inactive") recorder.stop();
      return stopped;
    },
    cancel() {
      clearTimeout(timer);
      chunks.length = 0;
      if (recorder.state !== "inactive") recorder.stop();
    },
  };
}
