import { useCallback, useEffect, useRef, useState } from 'react';
import kioskApi from '../../kioskApi';
import { playBase64Audio } from '../../lib/playBase64Audio';
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

function extractErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as {
    response?: { data?: { error?: string } };
    message?: string;
  };
  return axiosErr?.response?.data?.error || axiosErr?.message || fallback;
}

export default function VoiceConsultant({
  greeting,
  name,
  branch,
}: VoiceConsultantProps) {
  const [state, setState] = useState<ConsultState>('idle');
  const [transcript, setTranscript] = useState<string>('');
  const [reply, setReply] = useState<string>('');
  const [converted, setConverted] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [micBlocked, setMicBlocked] = useState<boolean>(false);
  // Live mic level (0..1) so the orb reacts to the speaker's voice.
  const [level, setLevel] = useState<number>(0);

  // Media / audio graph refs — never trigger re-renders.
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordMimeRef = useRef<string>('audio/webm');
  const rafRef = useRef<number | null>(null);

  // Conversation state mirrored into refs for the VAD loop (runs outside React).
  const sessionActiveRef = useRef(false); // the hands-free session is running
  const phaseRef = useRef<ConsultState>('idle'); // mirror of `state`
  const speechDetectedRef = useRef(false); // did this utterance contain speech?
  const speechStartRef = useRef(0);
  const lastVoiceRef = useRef(0);
  const mountedRef = useRef(true);

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
      teardownAudio();
    };
  }, [teardownAudio]);

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
          try {
            await playBase64Audio(data.audioBase64, data.mime);
          } catch {
            // Autoplay/codec failure shouldn't break the loop.
          }
        }
      } catch (err) {
        if (!mountedRef.current) return;
        setError(
          extractErrorMessage(
            err,
            'Could not process what you said. Please try again.',
          ),
        );
      } finally {
        // Resume the hands-free loop (unless the visitor ended the session).
        if (mountedRef.current && sessionActiveRef.current) {
          beginListening();
        } else if (mountedRef.current) {
          setPhase('idle');
        }
      }
    },
    // beginListening is declared below; it's stable (useCallback) so referencing
    // it here via the hoisted binding is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setPhase],
  );

  // ── Finish the current utterance → recorder.stop() → onstop → sendAudio ──────
  const endUtterance = useCallback(() => {
    stopRaf();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop(); // fires onstop
      } catch {
        if (sessionActiveRef.current) beginListening();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopRaf]);

  // ── The VAD monitor: reads the analyser each frame, ends the utterance on
  //    trailing silence after speech. ───────────────────────────────────────────
  const monitor = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser || phaseRef.current !== 'listening') return;

    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    let sumSq = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / buf.length);
    if (mountedRef.current) setLevel(rms);

    const now = performance.now();
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

    rafRef.current = requestAnimationFrame(monitor);
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
      recorder = new MediaRecorder(stream);
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
        beginListening();
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
    rafRef.current = requestAnimationFrame(monitor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monitor, sendAudio, setPhase, teardownAudio]);

  // ── Start the hands-free session (one tap) ───────────────────────────────────
  const startSession = useCallback(async () => {
    setError(null);
    setTranscript('');
    setReply('');

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      setMicBlocked(true);
      setError(
        'The microphone is unavailable. Open this kiosk over HTTPS (or on localhost) to use the voice assistant.',
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      setMicBlocked(false);

      // Audio graph for VAD. Created after the tap (a user gesture) so the
      // AudioContext is allowed to run.
      const Ctx: typeof AudioContext =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctx();
      if (ctx.state === 'suspended') await ctx.resume();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;

      sessionActiveRef.current = true;
      beginListening();
    } catch (err) {
      if (!mountedRef.current) return;
      setMicBlocked(true);
      const errName = (err as { name?: string })?.name;
      setError(
        errName === 'NotAllowedError' || errName === 'SecurityError'
          ? 'Microphone permission was denied. Allow the microphone (and use HTTPS/localhost) to talk to the assistant.'
          : 'Could not access the microphone. Check your device and try again.',
      );
      setPhase('idle');
    }
  }, [beginListening, setPhase]);

  // ── End the hands-free session (tap again) ───────────────────────────────────
  const stopSession = useCallback(() => {
    sessionActiveRef.current = false;
    teardownAudio();
    setLevel(0);
    setPhase('idle');
  }, [setPhase, teardownAudio]);

  const active = state !== 'idle';
  const statusLabel: Record<ConsultState, string> = {
    idle: 'Tap to start talking',
    listening: 'Listening… just speak',
    processing: 'Thinking…',
    speaking: 'Speaking…',
  };

  // Orb scales gently with the live mic level while listening.
  const orbScale =
    state === 'listening' ? 1 + Math.min(0.35, level * 4) : 1;

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 text-white flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-2xl flex flex-col items-center gap-6">
        {/* Header */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-3 mb-2">
            <Bot className="w-9 h-9 text-emerald-400" />
            <h1 className="text-3xl sm:text-4xl font-bold">Voice Consultant</h1>
          </div>
          {(name || branch) && (
            <p className="text-slate-300 text-lg">
              {name ? `Welcome, ${name}` : 'Welcome'}
              {branch ? ` · ${branch}` : ''}
            </p>
          )}
        </div>

        {/* Greeting bubble */}
        {greeting && !transcript && !reply && (
          <div className="w-full bg-slate-700/60 rounded-2xl px-6 py-5 text-center text-xl leading-relaxed shadow-lg anim-fade-in">
            <MessageCircle className="inline-block w-6 h-6 mr-2 text-emerald-300 align-text-bottom" />
            {greeting}
          </div>
        )}

        {/* Converted celebration banner */}
        {converted && (
          <div
            role="status"
            className="relative overflow-hidden w-full bg-emerald-500/90 text-white rounded-2xl px-6 py-5 flex items-center gap-3 shadow-xl anim-pop"
          >
            <PartyPopper className="w-8 h-8 shrink-0 animate-bounce" />
            <div>
              <p className="text-xl font-bold">You are enrolled! 🎉</p>
              <p className="text-emerald-50">
                Welcome aboard{name ? `, ${name}` : ''}. Our team will be in
                touch shortly.
              </p>
            </div>
          </div>
        )}

        {/* Error / mic-blocked notice */}
        {error && (
          <div className="w-full bg-amber-500/20 border border-amber-400/50 text-amber-100 rounded-2xl px-5 py-4 flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 shrink-0 text-amber-300" />
            <p className="text-base">{error}</p>
          </div>
        )}

        {/* Conversation transcript / reply */}
        {(transcript || reply) && (
          <div className="w-full flex flex-col gap-3">
            {transcript && (
              <div className="self-end max-w-[85%] bg-emerald-600 rounded-2xl rounded-br-sm px-5 py-3 shadow anim-slide-in-right">
                <div className="flex items-center gap-2 text-emerald-100 text-xs font-semibold mb-1 uppercase tracking-wide">
                  <User className="w-4 h-4" /> You
                </div>
                <p className="text-lg leading-snug">{transcript}</p>
              </div>
            )}
            {reply && (
              <div className="self-start max-w-[85%] bg-slate-700 rounded-2xl rounded-bl-sm px-5 py-3 shadow anim-slide-in-left">
                <div className="flex items-center gap-2 text-emerald-300 text-xs font-semibold mb-1 uppercase tracking-wide">
                  <Bot className="w-4 h-4" /> Consultant
                </div>
                <p className="text-lg leading-snug whitespace-pre-wrap">
                  {reply}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Single hands-free control */}
        <div className="flex flex-col items-center gap-4 mt-2">
          <button
            type="button"
            aria-label={active ? 'End conversation' : 'Start conversation'}
            onClick={active ? stopSession : () => void startSession()}
            className={[
              'relative w-40 h-40 sm:w-48 sm:h-48 rounded-full flex items-center justify-center',
              'shadow-2xl transition-transform duration-150 select-none focus:outline-none',
              'focus:ring-4 focus:ring-emerald-300/50',
              state === 'processing'
                ? 'bg-slate-600'
                : state === 'speaking'
                  ? 'bg-indigo-500'
                  : state === 'listening'
                    ? 'bg-red-600 ring-8 ring-red-400/40'
                    : 'bg-emerald-500 hover:bg-emerald-400 anim-breathe',
            ].join(' ')}
            style={{ transform: `scale(${orbScale})` }}
          >
            {/* Listening ripples react to the live level */}
            {state === 'listening' && (
              <>
                <span
                  aria-hidden="true"
                  className="anim-pulse-ring pointer-events-none absolute inset-0 rounded-full border-4 border-red-300/60"
                />
                <span
                  aria-hidden="true"
                  className="anim-pulse-ring pointer-events-none absolute inset-0 rounded-full border-4 border-red-300/60"
                  style={{ animationDelay: '0.8s' }}
                />
              </>
            )}
            {state === 'processing' ? (
              <Loader2 className="w-16 h-16 animate-spin" />
            ) : state === 'speaking' ? (
              <Volume2 className="w-16 h-16 animate-pulse" />
            ) : active ? (
              <PhoneOff className="w-14 h-14" />
            ) : (
              <Mic className="w-16 h-16" />
            )}
          </button>

          {/* Speaking equalizer */}
          {state === 'speaking' && (
            <div
              aria-hidden="true"
              className="flex items-end justify-center gap-1.5 h-8"
            >
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className="anim-bar inline-block w-2 rounded-full bg-indigo-300"
                  style={{ height: '2rem', animationDelay: `${i * 120}ms` }}
                />
              ))}
            </div>
          )}

          <p className="text-xl font-medium text-slate-200 h-7 flex items-center justify-center gap-1">
            <span>{statusLabel[state]}</span>
            {state === 'processing' && (
              <span aria-hidden="true" className="inline-flex items-end gap-1 ml-1">
                <span
                  className="anim-dot inline-block w-1.5 h-1.5 rounded-full bg-slate-300"
                  style={{ animationDelay: '0ms' }}
                />
                <span
                  className="anim-dot inline-block w-1.5 h-1.5 rounded-full bg-slate-300"
                  style={{ animationDelay: '150ms' }}
                />
                <span
                  className="anim-dot inline-block w-1.5 h-1.5 rounded-full bg-slate-300"
                  style={{ animationDelay: '300ms' }}
                />
              </span>
            )}
          </p>
          {active && (
            <p className="text-sm text-slate-400">
              Tap the button again to end the conversation.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
