import { useCallback, useEffect, useRef, useState } from 'react';
import kioskApi from '../../kioskApi';
import { playBase64Audio } from '../../lib/playBase64Audio';
import {
  Mic,
  Square,
  Loader2,
  Volume2,
  Send,
  PartyPopper,
  AlertTriangle,
  MessageCircle,
  Bot,
  User,
} from 'lucide-react';

/**
 * VoiceConsultant — push-to-talk kiosk voice loop.
 *
 * This is a PUBLIC terminal component: it talks to the backend through the
 * dedicated `kioskApi` axios instance (which attaches the short-lived
 * x-kiosk-token and never the admin bearer / never redirects to /login).
 *
 * The loop is:  idle → recording → processing → playing → idle (re-armed)
 * with a text-input fallback that hits the very same /api/kiosk/consult
 * endpoint as JSON, so the kiosk still works when the microphone is blocked
 * (e.g. served over plain HTTP where getUserMedia is unavailable).
 */

type ConsultState = 'idle' | 'recording' | 'processing' | 'playing';

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
  return (
    axiosErr?.response?.data?.error || axiosErr?.message || fallback
  );
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
  const [textInput, setTextInput] = useState<string>('');

  // Mutable media refs — never trigger re-renders.
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordMimeRef = useRef<string>('audio/webm');
  // Guards async work that resolves after the component has unmounted.
  const mountedRef = useRef<boolean>(true);

  const stopStream = useCallback(() => {
    const stream = mediaStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
  }, []);

  // Cleanup MediaRecorder + stream on unmount.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          /* ignore */
        }
      }
      mediaRecorderRef.current = null;
      stopStream();
    };
  }, [stopStream]);

  // Shared handler for a consult response (voice or text).
  const handleResponse = useCallback(async (data: ConsultResponse) => {
    if (!mountedRef.current) return;
    setTranscript(data.transcript || '');
    setReply(data.reply || '');
    if (data.converted) setConverted(true);

    if (data.audioBase64 && data.mime) {
      setState('playing');
      try {
        await playBase64Audio(data.audioBase64, data.mime);
      } catch {
        // Autoplay/codec failure shouldn't break the loop — the text reply
        // is already on screen.
      }
    }
    if (mountedRef.current) setState('idle');
  }, []);

  // Send the recorded audio Blob as multipart form-data.
  const sendAudio = useCallback(
    async (blob: Blob, mimeType: string) => {
      if (!mountedRef.current) return;
      setState('processing');
      setError(null);
      try {
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const form = new FormData();
        form.append('audio', blob, `consult.${ext}`);
        const res = await kioskApi.post<ConsultResponse>(
          '/api/kiosk/consult',
          form,
        );
        await handleResponse(res.data);
      } catch (err) {
        if (!mountedRef.current) return;
        setError(extractErrorMessage(err, 'Could not process your voice. Please try again.'));
        setState('idle');
      }
    },
    [handleResponse],
  );

  // Begin push-to-talk recording.
  const startRecording = useCallback(async () => {
    if (state === 'recording' || state === 'processing') return;
    setError(null);

    // Insecure context / no mediaDevices → fall back to text only.
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      setMicBlocked(true);
      setError(
        'The microphone is unavailable. Open this kiosk over HTTPS or on localhost to talk — you can still type your question below.',
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      mediaStreamRef.current = stream;
      setMicBlocked(false);

      const mimeType = pickSupportedMimeType();
      recordMimeRef.current = mimeType || 'audio/webm';
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (ev: BlobEvent) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        stopStream();
        const blobType = recordMimeRef.current;
        const blob = new Blob(chunksRef.current, { type: blobType });
        chunksRef.current = [];
        if (blob.size === 0) {
          if (mountedRef.current) setState('idle');
          return;
        }
        void sendAudio(blob, blobType);
      };

      recorder.start();
      setState('recording');
    } catch (err) {
      if (!mountedRef.current) return;
      setMicBlocked(true);
      const errName = (err as { name?: string })?.name;
      if (errName === 'NotAllowedError' || errName === 'SecurityError') {
        setError(
          'Microphone permission was denied. Allow the microphone, or open the kiosk over HTTPS / localhost. You can still type your question below.',
        );
      } else {
        setError(
          'Could not access the microphone. You can still type your question below.',
        );
      }
      setState('idle');
    }
  }, [state, sendAudio, stopStream]);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop(); // triggers onstop → sendAudio
      } catch {
        stopStream();
        if (mountedRef.current) setState('idle');
      }
    }
  }, [stopStream]);

  // Text fallback — posts { text } as JSON to the same endpoint.
  const sendText = useCallback(async () => {
    const text = textInput.trim();
    if (!text || state === 'processing' || state === 'recording') return;
    setState('processing');
    setError(null);
    setTextInput('');
    try {
      const res = await kioskApi.post<ConsultResponse>('/api/kiosk/consult', {
        text,
      });
      // Echo the typed question as the transcript if backend doesn't.
      if (!res.data.transcript) {
        setTranscript(text);
      }
      await handleResponse(res.data);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(extractErrorMessage(err, 'Could not get a reply. Please try again.'));
      setState('idle');
    }
  }, [textInput, state, handleResponse]);

  const busy = state === 'processing' || state === 'playing';

  const statusLabel: Record<ConsultState, string> = {
    idle: 'Tap and hold to talk',
    recording: 'Listening… release to send',
    processing: 'Thinking…',
    playing: 'Speaking…',
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 text-white flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-2xl flex flex-col items-center gap-6">
        {/* Header */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-3 mb-2">
            <Bot className="w-9 h-9 text-emerald-400" />
            <h1 className="text-3xl sm:text-4xl font-bold">
              Voice Consultant
            </h1>
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
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-4 top-2 text-2xl animate-bounce"
              style={{ animationDelay: '120ms' }}
            >
              🎉
            </span>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-12 bottom-2 text-xl animate-bounce opacity-80"
              style={{ animationDelay: '480ms' }}
            >
              ✨
            </span>
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

        {/* Push-to-talk control */}
        <div className="flex flex-col items-center gap-4 mt-2">
          <button
            type="button"
            aria-label={
              state === 'recording' ? 'Stop recording' : 'Start recording'
            }
            disabled={busy}
            onMouseDown={state === 'recording' ? undefined : startRecording}
            onMouseUp={state === 'recording' ? stopRecording : undefined}
            onMouseLeave={state === 'recording' ? stopRecording : undefined}
            onTouchStart={(e) => {
              e.preventDefault();
              if (state !== 'recording') void startRecording();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              if (state === 'recording') stopRecording();
            }}
            className={[
              'relative w-40 h-40 sm:w-48 sm:h-48 rounded-full flex items-center justify-center',
              'shadow-2xl transition-all duration-200 select-none focus:outline-none',
              'focus:ring-4 focus:ring-emerald-300/50',
              busy
                ? 'bg-slate-600 cursor-not-allowed'
                : state === 'recording'
                  ? 'bg-red-600 scale-110 ring-8 ring-red-400/40'
                  : 'bg-emerald-500 hover:bg-emerald-400 active:scale-95',
              state === 'idle' && !busy ? 'anim-breathe' : '',
            ].join(' ')}
          >
            {/* Listening ripples — expanding rings while recording */}
            {state === 'recording' && (
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
            ) : state === 'playing' ? (
              <Volume2 className="w-16 h-16 animate-pulse" />
            ) : state === 'recording' ? (
              <Square className="relative w-14 h-14" />
            ) : (
              <Mic className="w-16 h-16" />
            )}
          </button>
          {/* Speaking equalizer — animated bars while the agent talks */}
          {state === 'playing' && (
            <div
              aria-hidden="true"
              className="flex items-end justify-center gap-1.5 h-8"
            >
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className="anim-bar inline-block w-2 rounded-full bg-emerald-400"
                  style={{ height: '2rem', animationDelay: `${i * 120}ms` }}
                />
              ))}
            </div>
          )}
          <p className="text-xl font-medium text-slate-200 h-7 flex items-center justify-center gap-1">
            <span>{statusLabel[state]}</span>
            {state === 'processing' && (
              <span
                aria-hidden="true"
                className="inline-flex items-end gap-1 ml-1"
              >
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
        </div>

        {/* Text fallback */}
        <div className="w-full mt-4">
          <label
            htmlFor="kiosk-text"
            className="block text-sm text-slate-400 mb-2"
          >
            {micBlocked
              ? 'Microphone unavailable — type your question instead'
              : 'Or type your question'}
          </label>
          <div className="flex gap-2">
            <input
              id="kiosk-text"
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void sendText();
              }}
              disabled={state === 'processing' || state === 'recording'}
              placeholder="Ask about courses, fees, schedules…"
              className="flex-1 rounded-xl bg-slate-700 border border-slate-600 px-4 py-4 text-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void sendText()}
              disabled={
                !textInput.trim() ||
                state === 'processing' ||
                state === 'recording'
              }
              aria-label="Send question"
              className="rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-600 disabled:cursor-not-allowed px-6 py-4 flex items-center justify-center transition-colors"
            >
              <Send className="w-6 h-6" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
