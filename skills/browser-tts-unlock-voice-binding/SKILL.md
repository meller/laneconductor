---
name: browser-tts-unlock-voice-binding
description: "Make browser text-to-speech (window.speechSynthesis) actually audible: unlock it with a silent utterance on the first user gesture, and bind an explicit SpeechSynthesisVoice to every utterance instead of setting only lang."
when_to_use: "Use when adding text-to-speech, read-aloud, pronunciation or audio playback with speechSynthesis or SpeechSynthesisUtterance to a web app; when the first speak() call is silent, speaks no audio with no error, or only some utterances play; or when setting utterance.lang."
paths: "package.json"
metadata:
  kind: convention
  stack: [browser, web-speech-api, speechsynthesis, react, vite, typescript]
  provenance: observed in the author's own projects with LaneConductor
  prerequisites:
    - A browser-side app (Vite/React or plain DOM) that calls window.speechSynthesis directly.
    - A real browser to test in; jsdom has no speechSynthesis, so unit tests need an injected port.
  verified: 2026-11-18
---

## Why this works
Observed in the author's own projects with LaneConductor: two web apps lost their first spoken
utterance in the browser; `speak()` returned without an error and nothing was heard. A
silent-utterance unlock fixed it in the first and was ported (speech part only) to the second,
where the first Play press was silent until it was added. A second, separate cause in the second
app was setting only `utterance.lang`. Both fixes cost real debugging time because the failure is
silent.

## Recommendation
- Install the unlock once at app start: copy `files/audioUnlocker.ts` and call
  `installAudioUnlocker()` in `main.tsx` before rendering. It listens (once) for `click`,
  `touchstart` and `keydown` on `document`, speaks `new SpeechSynthesisUtterance("")` with
  `volume = 0`, and resumes the engine if `paused`. Raw DOM listeners, not a React handler.
- If the app also uses Web Audio, create the `AudioContext` in that same first-gesture handler and
  `resume()` it if `suspended` (the first app did this by playing a silent buffer there).
- Bind a voice explicitly. Resolve it from `speechSynthesis.getVoices()` by the primary language
  subtag (`voice.lang.toLowerCase().startsWith(lang.split("-")[0].toLowerCase())`) and assign
  `utterance.voice`, in addition to `utterance.lang` and `utterance.rate`. Voices load late: listen
  for `voiceschanged` before treating the list as empty.
- Wrap the engine in a small injected port (speak, cancel, pause, resume, getVoices) so Vitest can
  drive start/boundary/end/error without a browser.

## Claude does
- Copy `files/audioUnlocker.ts` into the client source folder and add the one call in the entry file.
- Resolve and assign `utterance.voice` wherever an utterance is created; never rely on `lang` alone.
- Add a manual check to the track's test plan: first press of Play, in Chrome, on a fresh page load.

## You run
1. Open the app in Chrome, load fresh, click Play once, and confirm audio on the first press. It
   needs a real browser with sound; Claude cannot hear it.
2. Repeat on a Windows/Edge machine and on a phone if the product targets them; voices differ per
   OS and the failures below were found on real devices.

## Pitfalls
- Setting only `utterance.lang` produced no audio in Chrome (the `speak()` call accepted, nothing
  spoken). Assigning a matched `SpeechSynthesisVoice` fixed it (a code comment in one app;
  observed there, not in MDN).
- Chrome blocks `speak()` without user activation since M71 (blink-dev "Intent to Deprecate:
  speechSynthesis.speak without user activation"). The author's own observation is the narrower
  and more useful one: a first `speak()` reached through React state updates was silent even though
  it started from a click; only the raw-event-handler unlock fixed it. The silent-empty-utterance
  trick itself is observed, not documented by Google.
- Chromium drops a `speak()` issued in the same task as a preceding `cancel()`: no error, no
  `onerror`, silence. Defer the `speak()` by about 60 ms after any `cancel()`. Symptom: the first
  block speaks, later blocks do not (observed in the author's app).
- Cancelling while paused wedges Chromium's engine: queue cleared, paused state kept, every later
  `speak()` swallowed. Call `resume()` right after `cancel()`, and call `resume()` unconditionally
  before `speak()`: Edge/Chromium can report `paused === false` while wedged (observed).
- A `cancel()` fires `error: "interrupted"` or `"canceled"` on the utterance it stopped. Do not treat
  those as failures or you will downgrade a healthy browser to a fallback clock; any other or
  missing error code is fatal.
- Do not time out on a slow first `start`: 889 ms from `speak()` to `start` was measured for a
  SAPI voice on Edge/Windows. Check `speaking || pending` before declaring failure.
- Windows SAPI voices often send no `boundary` event; word highlighting by boundary needs a timer
  fallback (a code comment in the author's app; not verified beyond that).
- Web Audio: an `AudioContext` created before a user gesture starts `suspended` and needs
  `resume()` after one (confirmed in Chrome's autoplay article, developer.chrome.com/blog/autoplay).
- iOS Safari wants the first utterance triggered by a user action; this is stated in a component
  comment in the author's first app, UNVERIFIED on a device here.
