import { useCallback, useEffect, useRef, useState } from 'react';
import kioskApi from '../../kioskApi';
import {
  playBase64Audio,
  releaseAudioPlayback,
  unlockAudioPlayback,
} from '../../lib/playBase64Audio';
import { useWakeLock } from '../../hooks/useWakeLock';
import {
  Mic,
  Loader2,
  Volume2,
  PartyPopper,
  AlertTriangle,
  MessageCircle,
  Bot,
  User,
  PhoneOff,
  Sparkles,
  X,
} from 'lucide-react';

/**
 * VoiceConsultant — HANDS-FREE continuous kiosk voice loop.
 *
 * Tap ONCE to start the conversation; then just talk. The component keeps the
 * mic open, detects when you stop speaking (silence-based VAD), sends that
 * utterance, speaks the reply, and automatically listens again — a natural,
 * back-and-forth conversation like talking to a person. Tap again to end.
 *
 * There is intentionally NO text-chat fallback: this is a voice-only assistant.
 * The mic requires a secure context (HTTPS or localhost) for getUserMedia.
 *
 * Loop:  idle → listening → (silence) → processing → speaking → listening → …
 *
 * Talks to the backend through the dedicated `kioskApi` axios instance (the
 * short-lived x-kiosk-token, never the admin bearer). The reply is synthesized
 * by the operator-configured OpenRouter TTS model (Add Model section).
 */

type ConsultState = 'idle' | 'listening' | 'processing' | 'speaking';

interface ConsultResponse {
  transcript?: string;
  reply?: string;
  audioBase64?: string;
  mime?: 'audio/wav' | 'audio/mpeg' | string;
  converted?: boolean;
}

interface VoiceConsultantProps {
  greeting?: string;
  name?: string;
  branch?: string;
  /** When provided, renders an "End session" control in the top bar. */
  onEndSession?: () => void;
  /**
   * Called when the backend rejects the kiosk token (30-minute TTL). Without
   * it an expired session showed "Could not process what you said" on every
   * turn forever, with no way back to the code screen.
   */
  onSessionExpired?: () => void;
}

// Preferred recording mime types, most-compatible first.
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
];

// ── Voice-activity-detection (VAD) tuning ────────────────────────────────────
// RMS (0..1) below this counts as silence.
const SILENCE_RMS = 0.02;
// End the utterance after this much continuous silence FOLLOWING speech.
const SILENCE_HANG_MS = 1200;
// Ignore blips shorter than this (a cough, a click) so we don't send noise.
const MIN_SPEECH_MS = 350;
// Hard cap on a single utterance so a stuck-open mic can't record forever.
const MAX_UTTERANCE_MS = 20000;

// ── Barge-in (interrupt the assistant while it's speaking) ───────────────────
// While the assistant is talking we keep watching the mic; if the visitor
// starts speaking we cut the assistant off and listen. The threshold is
// deliberately HIGHER than SILENCE_RMS so the assistant's own audio (residual
// echo, even after the browser's echo cancellation) doesn't self-trigger.
const BARGE_IN_RMS = 0.07;
// Require this much continuous speech before we interrupt (avoids a cough/click).
const BARGE_IN_MS = 280;

function pickSupportedMimeType(): string | undefined {
  if (
    typeof MediaRecorder === 'undefined' ||
    typeof MediaRecorder.isTypeSupported !== 'function'
  ) {
    return undefined;
  }
  for (const mt of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mt)) return mt;
  }
  return undefined;
}

/**
 * Mic constraints. `audio: true` alone leaves echo cancellation to the
 * browser's default, which on a kiosk tablet means the assistant's own voice
 * comes back through the speaker into the mic — the VAD then hears "speech"
 * for the whole reply and cuts the assistant off, or re-triggers instantly
 * after it finishes. Asking explicitly, in mono, is the difference between a
 * usable hands-free loop and one that talks to itself.
 */
const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
  video: false,
};

/** Does this browser have everything the hands-free loop needs? */
function missingHardwareSupport(): string | null {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
    return 'The microphone is unavailable. Open this page over HTTPS (or on localhost) to use the voice assistant.';
  }
  if (typeof navigator.mediaDevices.getUserMedia !== 'function') {
    return 'The microphone is unavailable. Open this page over HTTPS (or on localhost) to use the voice assistant.';
  }
  // Checked up front rather than at record time: iOS before 14.3 has
  // getUserMedia but no MediaRecorder, and finding that out mid-tap used to
  // throw inside beginListening with nothing on screen to explain it.
  if (typeof MediaRecorder === 'undefined') {
    return 'This browser cannot record audio. Please use a recent version of Chrome, Edge or Safari.';
  }
  if (
    typeof window === 'undefined' ||
    !(
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext
    )
  ) {
    return 'This browser cannot process audio. Please use a recent version of Chrome, Edge or Safari.';
  }
  return null;
}

/** UI level meter refresh — 12fps is plenty and costs 1/5 of a 60fps redraw. */
const LEVEL_UPDATE_MS = 80;

function extractErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as {
    response?: { data?: { error?: string } };
    message?: string;
  };
  return axiosErr?.response?.data?.error || axiosErr?.message || fallback;
}

function errorStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } } | undefined)?.response
    ?.status;
}

export default function VoiceConsultant({
  greeting,
  name,
  branch,
  onEndSession,
  onSessionExpired,
}: VoiceConsultantProps) {
  const [state, setState] = useState<ConsultState>('idle');
  const [transcript, setTranscript] = useState<string>('');
  const [reply, setReply] = useState<string>('');
  const [converted, setConverted] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // Write-only: every setMicBlocked(true) is paired with a setError() carrying
  // the operator-facing explanation, so the flag itself is never rendered.
  const [, setMicBlocked] = useState<boolean>(false);
  // Live mic level (0..1) so the orb reacts to the speaker's voice.
  const [level, setLevel] = useState<number>(0);
  // True between the tap and the mic actually opening. Kept separate from
  // `state` so the status line can say "waiting for the microphone" instead
  // of the misleading "Thinking…" while the permission prompt is up.
  const [starting, setStarting] = useState(false);

  // Media / audio graph refs — never trigger re-renders.
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordMimeRef = useRef<string>('audio/webm');
  const rafRef = useRef<number | null>(null);
  // Reused across frames. Allocating a fresh Uint8Array 60×/second was pure
  // GC pressure on the low-end tablets these kiosks actually run on.
  const vadBufRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const lastLevelPushRef = useRef(0);
  // Bumped by every start AND every stop. `startSession` captures the value
  // before awaiting the permission prompt and bails if it changed — otherwise
  // a visitor who taps twice while the prompt is up gets a session that starts
  // itself right after they cancelled it.
  const startTokenRef = useRef(0);

  // Conversation state mirrored into refs for the VAD loop (runs outside React).
  const sessionActiveRef = useRef(false); // the hands-free session is running
  const phaseRef = useRef<ConsultState>('idle'); // mirror of `state`
  const speechDetectedRef = useRef(false); // did this utterance contain speech?
  const speechStartRef = useRef(0);
  const lastVoiceRef = useRef(0);
  const mountedRef = useRef(true);

  // Barge-in: the AbortController for the currently-playing reply + a separate
  // VAD loop that watches for the visitor talking over it.
  const speakAbortRef = useRef<AbortController | null>(null);
  const bargeRafRef = useRef<number | null>(null);
  const bargeSpeechStartRef = useRef(0);

  // The hands-free loop is mutually recursive: sendAudio/endUtterance re-arm
  // the mic via beginListening, beginListening drives the VAD monitor, and the
  // monitor re-schedules itself each frame. Reaching a `const` callback from a
  // closure declared ABOVE it is a temporal-dead-zone hazard (and what the
  // react-hooks/immutability rule flags), so the back-edges go through these
  // refs instead. Each ref is re-pointed at the latest callback below, which
  // also means the recursion always calls the current closure rather than a
  // stale capture.
  const beginListeningRef = useRef<() => void>(() => {});
  const monitorRef = useRef<() => void>(() => {});

  const wakeLock = useWakeLock();

  const setPhase = useCallback((s: ConsultState) => {
    phaseRef.current = s;
    setState(s);
  }, []);

  // ── Teardown helpers ───────────────────────────────────────────────────────
  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const teardownAudio = useCallback(() => {
    stopRaf();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
    }
    recorderRef.current = null;
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state !== 'closed') {
      ctx.close().catch(() => {});
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
  }, [stopRaf]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionActiveRef.current = false;
      speakAbortRef.current?.abort();
      teardownAudio();
    };
  }, [teardownAudio]);

  // ── Barge-in watchers ───────────────────────────────────────────────────────
  const stopBargeInWatch = useCallback(() => {
    if (bargeRafRef.current !== null) {
      cancelAnimationFrame(bargeRafRef.current);
      bargeRafRef.current = null;
    }
    bargeSpeechStartRef.current = 0;
  }, []);

  // While the reply plays, watch the mic; if the visitor speaks over it for
  // BARGE_IN_MS, abort playback (→ playBase64Audio resolves → the loop re-arms
  // the mic and captures what they're saying).
  const startBargeInWatch = useCallback((ctrl: AbortController) => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    bargeSpeechStartRef.current = 0;
    const buf = new Uint8Array(analyser.fftSize);
    const tick = (): void => {
      if (ctrl.signal.aborted || phaseRef.current !== 'speaking') return;
      analyser.getByteTimeDomainData(buf);
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / buf.length);
      const now = performance.now();
      if (rms > BARGE_IN_RMS) {
        if (!bargeSpeechStartRef.current) bargeSpeechStartRef.current = now;
        else if (now - bargeSpeechStartRef.current > BARGE_IN_MS) {
          ctrl.abort(); // visitor is talking over the assistant → cut it off
          return;
        }
      } else {
        bargeSpeechStartRef.current = 0;
      }
      bargeRafRef.current = requestAnimationFrame(tick);
    };
    bargeRafRef.current = requestAnimationFrame(tick);
  }, []);

  // ── Send one captured utterance to the backend ───────────────────────────────
  const sendAudio = useCallback(
    async (blob: Blob, mimeType: string) => {
      if (!mountedRef.current) return;
      setPhase('processing');
      setError(null);
      try {
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const form = new FormData();
        form.append('audio', blob, `consult.${ext}`);
        const res = await kioskApi.post<ConsultResponse>(
          '/api/kiosk/consult',
          form,
        );
        const data = res.data;
        if (!mountedRef.current) return;
        setTranscript(data.transcript || '');
        setReply(data.reply || '');
        if (data.converted) setConverted(true);

        if (data.audioBase64 && data.mime) {
          setPhase('speaking');
          // Barge-in: play with an AbortController and watch the mic so the
          // visitor can talk over the assistant and cut it off.
          const ctrl = new AbortController();
          speakAbortRef.current = ctrl;
          startBargeInWatch(ctrl);
          try {
            await playBase64Audio(data.audioBase64, data.mime, ctrl.signal);
          } catch {
            // Autoplay/codec failure shouldn't break the loop.
          } finally {
            stopBargeInWatch();
            speakAbortRef.current = null;
          }
        }
      } catch (err) {
        if (!mountedRef.current) return;
        // The kiosk token lives 30 minutes. Once it lapses EVERY turn fails
        // identically, so retrying is pointless — stop the loop and hand the
        // visitor back to the code screen instead of looping an error.
        if (errorStatus(err) === 401) {
          sessionActiveRef.current = false;
          speakAbortRef.current?.abort();
          stopBargeInWatch();
          teardownAudio();
          setLevel(0);
          setPhase('idle');
          setError('This session has ended. Please enter your code again.');
          onSessionExpired?.();
          return;
        }
        setError(
          extractErrorMessage(
            err,
            'Could not process what you said. Please try again.',
          ),
        );
      } finally {
        // Resume the hands-free loop (unless the visitor ended the session).
        if (mountedRef.current && sessionActiveRef.current) {
          beginListeningRef.current();
        } else if (mountedRef.current) {
          setPhase('idle');
        }
      }
    },
    [
      setPhase,
      startBargeInWatch,
      stopBargeInWatch,
      teardownAudio,
      onSessionExpired,
    ],
  );

  // ── Finish the current utterance → recorder.stop() → onstop → sendAudio ──────
  const endUtterance = useCallback(() => {
    stopRaf();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop(); // fires onstop
      } catch {
        if (sessionActiveRef.current) beginListeningRef.current();
      }
    }
  }, [stopRaf]);

  // ── The VAD monitor: reads the analyser each frame, ends the utterance on
  //    trailing silence after speech. ───────────────────────────────────────────
  const monitor = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser || phaseRef.current !== 'listening') return;

    if (!vadBufRef.current || vadBufRef.current.length !== analyser.fftSize) {
      vadBufRef.current = new Uint8Array(analyser.fftSize);
    }
    const buf = vadBufRef.current;
    analyser.getByteTimeDomainData(buf);
    let sumSq = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / buf.length);

    const now = performance.now();
    // The VAD decision below runs every frame (it must, to catch the end of
    // an utterance promptly), but the orb only needs to look alive — pushing
    // React state 60×/second re-rendered the whole screen for a 1px change.
    if (
      mountedRef.current &&
      now - lastLevelPushRef.current > LEVEL_UPDATE_MS
    ) {
      lastLevelPushRef.current = now;
      setLevel(rms);
    }
    if (rms > SILENCE_RMS) {
      if (!speechDetectedRef.current) {
        speechDetectedRef.current = true;
        speechStartRef.current = now;
      }
      lastVoiceRef.current = now;
    } else if (speechDetectedRef.current) {
      const spoke = now - speechStartRef.current;
      const silent = now - lastVoiceRef.current;
      if (silent > SILENCE_HANG_MS && spoke > MIN_SPEECH_MS) {
        endUtterance();
        return;
      }
    }

    // Hard cap.
    if (
      speechDetectedRef.current &&
      now - speechStartRef.current > MAX_UTTERANCE_MS
    ) {
      endUtterance();
      return;
    }

    rafRef.current = requestAnimationFrame(() => monitorRef.current());
  }, [endUtterance]);

  // ── Arm a fresh listening turn on the already-open stream ────────────────────
  const beginListening = useCallback(() => {
    if (!mountedRef.current || !sessionActiveRef.current) return;
    const stream = streamRef.current;
    if (!stream) return;

    speechDetectedRef.current = false;
    speechStartRef.current = 0;
    lastVoiceRef.current = 0;
    chunksRef.current = [];

    const mimeType = pickSupportedMimeType();
    recordMimeRef.current = mimeType || 'audio/webm';
    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch {
      // A rejected mimeType is recoverable; a browser with no usable recorder
      // at all is not. The previous version called the same constructor again
      // inside the catch, so the second throw escaped uncaught and the tap
      // died silently with the orb stuck on "listening".
      try {
        recorder = new MediaRecorder(stream);
      } catch {
        setError('This browser could not start the microphone recorder.');
        sessionActiveRef.current = false;
        teardownAudio();
        setPhase('idle');
        return;
      }
    }
    recorderRef.current = recorder;

    recorder.ondataavailable = (ev: BlobEvent) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    recorder.onstop = () => {
      const blobType = recordMimeRef.current;
      const blob = new Blob(chunksRef.current, { type: blobType });
      chunksRef.current = [];
      // Only send when we actually captured speech and the session is still on.
      if (
        sessionActiveRef.current &&
        speechDetectedRef.current &&
        blob.size > 0
      ) {
        void sendAudio(blob, blobType);
      } else if (sessionActiveRef.current) {
        // Stopped without speech (shouldn't normally happen) — keep listening.
        beginListeningRef.current();
      }
    };

    try {
      recorder.start();
    } catch {
      // If the recorder can't start, end the session gracefully.
      setError('The microphone stopped unexpectedly. Tap to try again.');
      sessionActiveRef.current = false;
      teardownAudio();
      setPhase('idle');
      return;
    }
    setPhase('listening');
    rafRef.current = requestAnimationFrame(() => monitorRef.current());
  }, [sendAudio, setPhase, teardownAudio]);

  // Keep the recursion back-edges pointing at the freshest closures.
  useEffect(() => {
    beginListeningRef.current = beginListening;
  }, [beginListening]);
  useEffect(() => {
    monitorRef.current = monitor;
  }, [monitor]);

  // ── Start the hands-free session (one tap) ───────────────────────────────────
  //
  // The ORDER here is load-bearing on iOS. Everything that needs the user
  // gesture — unlocking playback, constructing the AudioContext — happens
  // synchronously before the first `await`, because Safari drops the gesture
  // as soon as the call stack yields. Doing the AudioContext after
  // `await getUserMedia()` left it permanently suspended, so the VAD read
  // silence forever and the assistant never heard anything.
  const startSession = useCallback(async () => {
    setError(null);
    setTranscript('');
    setReply('');

    const unsupported = missingHardwareSupport();
    if (unsupported) {
      setMicBlocked(true);
      setError(unsupported);
      return;
    }
    const startToken = ++startTokenRef.current;

    // --- still inside the gesture ---------------------------------------
    unlockAudioPlayback();
    const Ctx: typeof AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    let ctx: AudioContext;
    try {
      ctx = new Ctx();
      audioCtxRef.current = ctx;
      // Fire-and-forget: iOS returns a promise here and we must not await it
      // before requesting the mic, or we lose the gesture for getUserMedia.
      if (ctx.state === 'suspended') void ctx.resume();
    } catch {
      setError('This browser could not start audio. Please try another one.');
      return;
    }
    // --- gesture may end here -------------------------------------------

    setStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      // Unmounted, or the visitor tapped again while the prompt was up — in
      // both cases the mic we just opened must be handed straight back.
      if (!mountedRef.current || startTokenRef.current !== startToken) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      setMicBlocked(false);

      // A suspended context produces an analyser that only ever reads
      // silence, so make sure it's running now that we're past the awaits.
      if (ctx.state === 'suspended') await ctx.resume();

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      analyserRef.current = analyser;
      vadBufRef.current = null;

      sessionActiveRef.current = true;
      wakeLock.request();
      beginListening();
    } catch (err) {
      if (!mountedRef.current) return;
      // Anything that failed AFTER the mic opened would otherwise leave the
      // stream live — the device keeps showing its recording indicator and
      // the mic stays reserved until the tab closes.
      teardownAudio();
      setMicBlocked(true);
      const errName = (err as { name?: string })?.name;
      setError(
        errName === 'NotAllowedError' || errName === 'SecurityError'
          ? 'Microphone permission was denied. Allow the microphone in your browser settings, then tap again.'
          : errName === 'NotFoundError' || errName === 'DevicesNotFoundError'
            ? 'No microphone was found on this device.'
            : errName === 'NotReadableError' || errName === 'TrackStartError'
              ? 'The microphone is already in use by another app. Close it and tap again.'
              : 'Could not access the microphone. Check your device and try again.',
      );
      setPhase('idle');
    } finally {
      if (mountedRef.current) setStarting(false);
    }
  }, [beginListening, setPhase, teardownAudio, wakeLock]);

  // ── End the hands-free session (tap again) ───────────────────────────────────
  const stopSession = useCallback(() => {
    // Invalidates any start still waiting on the permission prompt.
    startTokenRef.current += 1;
    setStarting(false);
    sessionActiveRef.current = false;
    speakAbortRef.current?.abort();
    stopBargeInWatch();
    teardownAudio();
    wakeLock.release();
    setLevel(0);
    setPhase('idle');
  }, [setPhase, teardownAudio, stopBargeInWatch, wakeLock]);

  /**
   * Backgrounding the tab (another app, screen lock, tab switch) stops
   * requestAnimationFrame — which is what drives the VAD. The recorder would
   * keep running with nothing left to notice the end of the utterance or the
   * hard cap, so a phone that went to sleep mid-sentence came back with a
   * minutes-long recording. Close the turn cleanly instead, and put the audio
   * graph back together on return.
   */
  useEffect(() => {
    const onVisibility = () => {
      if (!sessionActiveRef.current) return;
      if (document.visibilityState === 'hidden') {
        if (phaseRef.current === 'listening') endUtterance();
        return;
      }
      const ctx = audioCtxRef.current;
      // iOS suspends the context on interruption (a call, the lock screen).
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
      if (phaseRef.current === 'idle' && sessionActiveRef.current) {
        beginListeningRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [endUtterance]);

  // Drop the shared playback element when the consultant goes away, so a
  // later session starts from a clean one.
  useEffect(() => releaseAudioPlayback, []);

  const active = state !== 'idle' || starting;
  const statusLabel: Record<ConsultState, string> = {
    idle: 'Tap to start talking',
    listening: 'Listening… just speak',
    processing: 'Thinking…',
    speaking: 'Speaking… (talk to interrupt)',
  };
  const status = starting ? 'Waiting for the microphone…' : statusLabel[state];

  // Orb scales gently with the live mic level while listening.
  const orbScale = state === 'listening' ? 1 + Math.min(0.35, level * 4) : 1;

  const orbState =
    state === 'processing'
      ? 'bg-slate-600'
      : state === 'speaking'
        ? 'bg-gradient-to-br from-indigo-500 to-indigo-600'
        : state === 'listening'
          ? 'bg-gradient-to-br from-rose-500 to-red-600 ring-8 ring-red-400/30'
          : 'bg-gradient-to-br from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 anim-breathe';

  return (
    <div className="relative flex min-h-[100dvh] w-full flex-col overflow-hidden bg-slate-950 text-white">
      {/* Ambient background */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900" />
        <div
          className={[
            'absolute left-1/2 top-[-15%] h-[55vmin] w-[55vmin] -translate-x-1/2 rounded-full blur-[110px] transition-colors duration-700',
            state === 'listening'
              ? 'bg-rose-500/25'
              : state === 'speaking'
                ? 'bg-indigo-500/25'
                : 'bg-emerald-500/20',
          ].join(' ')}
        />
        <div className="absolute bottom-[-10%] right-[-5%] h-[45vmin] w-[45vmin] rounded-full bg-indigo-500/10 blur-[110px]" />
      </div>

      {/* Top bar — padded past the notch on iOS (viewport-fit=cover) */}
      <header
        className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-white/10 bg-slate-950/50 px-4 py-3 backdrop-blur-md sm:px-6 sm:py-4"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-500/15 ring-1 ring-emerald-400/30 sm:h-10 sm:w-10">
            <Sparkles className="h-5 w-5 text-emerald-300" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-400 sm:text-xs">
              AI Consultant
            </p>
            <p className="truncate text-sm font-bold sm:text-base">
              {branch || 'Voice Assistant'}
            </p>
          </div>
        </div>
        {onEndSession && (
          <button
            type="button"
            onClick={onEndSession}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold text-slate-100 ring-1 ring-white/15 transition-colors hover:bg-red-500/80 hover:ring-red-400/50 sm:px-4"
          >
            <X className="h-4 w-4" />
            <span className="hidden sm:inline">End session</span>
            <span className="sm:hidden">End</span>
          </button>
        )}
      </header>

      {/* Main stage. The conversation can grow past the viewport on a phone,
          so this column scrolls while the orb stays reachable at the bottom. */}
      <main
        className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col items-center gap-5 overflow-y-auto px-4 py-6 sm:gap-7 sm:py-10"
        style={{
          paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
        }}
      >
        {name && (
          <p className="text-center text-base text-slate-300 sm:text-lg">
            Welcome, <span className="font-semibold text-white">{name}</span>
          </p>
        )}

        {/* Greeting */}
        {greeting && !transcript && !reply && (
          <div className="anim-fade-in w-full rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-center text-base leading-relaxed shadow-lg backdrop-blur-sm sm:px-6 sm:py-5 sm:text-lg">
            <MessageCircle className="mr-2 inline-block h-5 w-5 align-text-bottom text-emerald-300 sm:h-6 sm:w-6" />
            {greeting}
          </div>
        )}

        {/* Conversion celebration */}
        {converted && (
          <div
            role="status"
            className="anim-pop relative w-full overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-5 py-4 shadow-xl sm:px-6 sm:py-5"
          >
            <div className="flex items-center gap-3">
              <PartyPopper className="h-7 w-7 shrink-0 animate-bounce sm:h-8 sm:w-8" />
              <div>
                <p className="text-lg font-bold sm:text-xl">
                  You are enrolled! 🎉
                </p>
                <p className="text-sm text-emerald-50 sm:text-base">
                  Welcome aboard{name ? `, ${name}` : ''}. Our team will be in
                  touch shortly.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Error / mic-blocked */}
        {error && (
          <div className="flex w-full items-start gap-3 rounded-2xl border border-amber-400/50 bg-amber-500/15 px-4 py-3 text-amber-100 sm:px-5 sm:py-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-300 sm:h-6 sm:w-6" />
            <p className="text-sm sm:text-base">{error}</p>
          </div>
        )}

        {/* Conversation */}
        {(transcript || reply) && (
          <div className="flex w-full flex-col gap-3">
            {transcript && (
              <div className="anim-slide-in-right max-w-[90%] self-end rounded-2xl rounded-br-sm bg-emerald-600 px-4 py-3 shadow sm:max-w-[80%] sm:px-5">
                <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-emerald-100">
                  <User className="h-3.5 w-3.5" /> You
                </div>
                <p className="text-base leading-snug sm:text-lg">
                  {transcript}
                </p>
              </div>
            )}
            {reply && (
              <div className="anim-slide-in-left max-w-[90%] self-start rounded-2xl rounded-bl-sm border border-white/10 bg-slate-800/80 px-4 py-3 shadow backdrop-blur-sm sm:max-w-[80%] sm:px-5">
                <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
                  <Bot className="h-3.5 w-3.5" /> Consultant
                </div>
                <p className="whitespace-pre-wrap text-base leading-snug sm:text-lg">
                  {reply}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Hands-free control — anchored toward the bottom for thumb reach */}
        <div className="mt-auto flex w-full flex-col items-center gap-4 pt-4">
          <button
            type="button"
            aria-label={active ? 'End conversation' : 'Start conversation'}
            onClick={active ? stopSession : () => void startSession()}
            className={[
              'relative flex items-center justify-center rounded-full',
              // Shrinks on short screens (phone in landscape) so the orb and
              // its status line still fit without scrolling.
              'h-28 w-28 sm:h-40 sm:w-40 lg:h-44 lg:w-44',
              'shadow-2xl transition-transform duration-150 will-change-transform select-none',
              'focus:outline-none focus:ring-4 focus:ring-emerald-300/50',
              orbState,
            ].join(' ')}
            style={{
              transform: `scale(${orbScale})`,
              // Kills the 300ms tap delay and double-tap-to-zoom, which on a
              // kiosk tablet turned an impatient second tap into a page zoom.
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {state === 'listening' && (
              <>
                <span
                  aria-hidden="true"
                  className="anim-pulse-ring pointer-events-none absolute inset-0 rounded-full border-4 border-rose-300/60"
                />
                <span
                  aria-hidden="true"
                  className="anim-pulse-ring pointer-events-none absolute inset-0 rounded-full border-4 border-rose-300/60"
                  style={{ animationDelay: '0.8s' }}
                />
              </>
            )}
            {starting || state === 'processing' ? (
              <Loader2 className="h-12 w-12 animate-spin sm:h-14 sm:w-14" />
            ) : state === 'speaking' ? (
              <Volume2 className="h-12 w-12 animate-pulse sm:h-14 sm:w-14" />
            ) : active ? (
              <PhoneOff className="h-11 w-11 sm:h-12 sm:w-12" />
            ) : (
              <Mic className="h-12 w-12 sm:h-14 sm:w-14" />
            )}
          </button>

          {/* Speaking equalizer */}
          {state === 'speaking' && (
            <div
              aria-hidden="true"
              className="flex h-6 items-end justify-center gap-1.5 sm:h-8"
            >
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className="anim-bar inline-block w-1.5 rounded-full bg-indigo-300 sm:w-2"
                  style={{ height: '2rem', animationDelay: `${i * 120}ms` }}
                />
              ))}
            </div>
          )}

          <p
            aria-live="polite"
            className="flex h-7 items-center justify-center gap-1 text-center text-base font-medium text-slate-200 sm:text-xl"
          >
            <span>{status}</span>
            {state === 'processing' && (
              <span
                aria-hidden="true"
                className="ml-1 inline-flex items-end gap-1"
              >
                {[0, 150, 300].map((d) => (
                  <span
                    key={d}
                    className="anim-dot inline-block h-1.5 w-1.5 rounded-full bg-slate-300"
                    style={{ animationDelay: `${d}ms` }}
                  />
                ))}
              </span>
            )}
          </p>
          <p className="min-h-[1.25rem] text-center text-xs text-slate-400 sm:text-sm">
            {active
              ? 'Just speak — I answer automatically. Tap to end.'
              : 'Tap once, then talk naturally.'}
          </p>
        </div>
      </main>
    </div>
  );
}
