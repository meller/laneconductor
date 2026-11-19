/**
 * Unlock browser speech synthesis on the first real user gesture (skill browser-tts-unlock-voice-binding).
 *
 * The very first speechSynthesis.speak() of a page session can silently no-op (no error, no sound)
 * unless an utterance was already fired from inside a raw DOM event handler. A React click handler is
 * often too indirect: by the time speak() runs, the browser may no longer count it as the gesture.
 * Fix: speak a silent, zero-volume utterance on the first click / touchstart / keydown anywhere on
 * the page. Call installAudioUnlocker() once at startup (e.g. in main.tsx, before React renders).
 * Returns an uninstall function.
 */
export function installAudioUnlocker(): () => void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return () => {};

  const events = ["click", "touchstart", "keydown"] as const;

  const unlock = () => {
    const utterance = new SpeechSynthesisUtterance("");
    utterance.volume = 0;
    window.speechSynthesis.speak(utterance);
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    events.forEach((event) => document.removeEventListener(event, unlock));
  };

  events.forEach((event) => document.addEventListener(event, unlock, { once: true }));
  return () => events.forEach((event) => document.removeEventListener(event, unlock));
}
