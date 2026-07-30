import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import kioskApi, { setKioskToken, clearKioskToken } from '../kioskApi';
import VoiceConsultant from '../components/voice/VoiceConsultant';

/**
 * Public, full-screen branch-kiosk page.
 *
 * Step 1 — a large 4-digit numeric code entry. The code is issued by an admin
 *           via /api/kiosk-admin/invite and handed to the visitor. Submitting it
 *           POSTs /api/kiosk/session (no token yet); a valid code returns a
 *           short-lived kiosk JWT which we stash in sessionStorage via
 *           setKioskToken().
 * Step 2 — the hands-free voice consultant loop (one tap → continuous voice).
 *
 * This page is intentionally rendered OUTSIDE the admin Layout / ProtectedRoute
 * so it needs no admin login — it lives on a shared terminal.
 */

const CODE_LENGTH = 4;

/**
 * Shared keypad styling. `touch-action: manipulation` removes the 300ms tap
 * delay AND double-tap-to-zoom — on a shared tablet an impatient second tap
 * used to zoom the page instead of entering a digit, leaving the kiosk stuck
 * at 2× with no way back. `select-none` stops a long-press turning into a
 * text-selection handle.
 */
const KEY_BASE =
  'flex aspect-square max-h-20 items-center justify-center rounded-2xl font-bold transition-all select-none hover:-translate-y-0.5 active:scale-95 disabled:hover:translate-y-0 sm:max-h-24';
const KEY_STYLE = {
  touchAction: 'manipulation' as const,
  WebkitTapHighlightColor: 'transparent',
};

type Step = 'code' | 'consult';

interface SessionInfo {
  name?: string;
  branch?: string;
  greeting?: string;
}

function errorStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } } | undefined)?.response
    ?.status;
}

function errorMessage(err: unknown): string | undefined {
  return (err as { response?: { data?: { error?: string } } } | undefined)
    ?.response?.data?.error;
}

export default function Kiosk() {
  const [searchParams] = useSearchParams();
  const isPreview = searchParams.get('preview') === '1';

  const [step, setStep] = useState<Step>('code');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<SessionInfo>({});

  const canSubmit = code.length === CODE_LENGTH && !submitting;

  const appendDigit = useCallback(
    (digit: string) => {
      setError(null);
      setCode((prev) =>
        prev.length >= CODE_LENGTH
          ? prev
          : (prev + digit).slice(0, CODE_LENGTH),
      );
    },
    [setCode],
  );

  const backspace = useCallback(() => {
    setError(null);
    setCode((prev) => prev.slice(0, -1));
  }, []);

  const clearCode = useCallback(() => {
    setError(null);
    setCode('');
  }, []);

  const submitCode = useCallback(async () => {
    if (code.length !== CODE_LENGTH || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await kioskApi.post('/api/kiosk/session', { code });
      const token: string | undefined = data?.token;
      if (!token) {
        setCode('');
        setError('Could not start a session. Please try again.');
        return;
      }
      setKioskToken(token);
      setSession({
        name: data?.name,
        branch: data?.branch,
        greeting: data?.greeting,
      });
      setStep('consult');
      setCode('');
    } catch (err) {
      // Clear the entry on failure. Beyond matching how every phone lock
      // screen behaves, it's what stops the auto-submit effect below from
      // re-firing on the same four digits and hammering the endpoint in a
      // loop once a code is rejected.
      setCode('');
      const status = errorStatus(err);
      if (status === 404) {
        setError('Invalid or expired code');
      } else if (status === 429) {
        setError('Too many attempts. Please wait a moment and try again.');
      } else {
        setError(
          errorMessage(err) || 'Something went wrong. Please try again.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  }, [code, submitting]);

  const endSession = useCallback(() => {
    clearKioskToken();
    setSession({});
    setCode('');
    setError(null);
    setStep('code');
  }, []);

  /**
   * The kiosk token only lives 30 minutes. When the backend rejects it the
   * consultant hands control back here, so the visitor lands on the code
   * screen with an explanation instead of a voice loop that fails silently.
   */
  const handleSessionExpired = useCallback(() => {
    clearKioskToken();
    setSession({});
    setCode('');
    setStep('code');
    setError('Your session timed out. Please enter your code again.');
  }, []);

  const dots = useMemo(
    () => Array.from({ length: CODE_LENGTH }).map((_, i) => i < code.length),
    [code.length],
  );

  // Keep the submit handler reachable from the keyboard listener without
  // re-subscribing on every keystroke.
  const submitRef = useRef(submitCode);
  useEffect(() => {
    submitRef.current = submitCode;
  }, [submitCode]);

  /**
   * Physical keyboard support. Plenty of these terminals are a laptop or a
   * tablet with a USB numpad, where the on-screen keypad is the slow way in —
   * and typing did nothing at all before this.
   */
  useEffect(() => {
    if (step !== 'code') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        appendDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        backspace();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        void submitRef.current();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        clearCode();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [step, appendDigit, backspace, clearCode]);

  /**
   * Auto-submit on the last digit — the same behaviour as a phone lock screen.
   * A visitor who has typed all four digits has nothing left to decide, and
   * the extra "Start" tap was the most common place people hesitated.
   */
  useEffect(() => {
    if (step !== 'code') return;
    if (code.length !== CODE_LENGTH || submitting) return;
    const t = setTimeout(() => void submitRef.current(), 180);
    return () => clearTimeout(t);
  }, [code, step, submitting]);

  if (step === 'consult') {
    // VoiceConsultant owns the full-screen consult experience (its own top bar
    // with the End-session control, ambient background, and responsive layout),
    // so we render it directly instead of wrapping it in a second header/frame.
    return (
      <VoiceConsultant
        greeting={session.greeting}
        name={session.name}
        branch={session.branch}
        onEndSession={endSession}
        onSessionExpired={handleSessionExpired}
      />
    );
  }

  return (
    // 100dvh, not 100vh: on mobile Safari the address bar makes 100vh taller
    // than the visible area, which pushed the Start button off-screen.
    <div
      className="flex min-h-[100dvh] w-full flex-col items-center justify-center overflow-y-auto bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950 anim-gradient px-4 py-8 text-white"
      style={{
        paddingTop: 'max(2rem, env(safe-area-inset-top))',
        paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
      }}
    >
      <div className="w-full max-w-md text-center anim-fade-in-up">
        <div className="text-sm uppercase tracking-[0.3em] text-emerald-400 font-semibold mb-2">
          Welcome
        </div>
        <h1 className="text-3xl sm:text-4xl font-black mb-2">
          Enter your code
        </h1>
        <p className="text-slate-300 text-base mb-8">
          Type the {CODE_LENGTH}-digit code provided by our team to start your
          consultation.
        </p>

        {isPreview && (
          <div className="mb-6 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-amber-200 text-sm">
            Preview mode — an admin can issue a fresh code and paste it here to
            test the kiosk.
          </div>
        )}

        {/* Code dots */}
        <div className="flex items-center justify-center gap-4 mb-6">
          {dots.map((filled, i) => {
            const isNext = !filled && i === code.length;
            return (
              <div
                key={i}
                className={`h-6 w-6 rounded-full border-2 transition-colors ${
                  filled
                    ? 'bg-emerald-400 border-emerald-400 anim-pop'
                    : isNext
                      ? 'bg-transparent border-emerald-300/70 anim-breathe'
                      : 'bg-transparent border-white/30'
                }`}
              />
            );
          })}
        </div>

        {error && (
          <div
            role="alert"
            className="mb-6 rounded-xl border border-red-400/50 bg-red-500/15 px-4 py-3 text-red-200 text-base font-semibold anim-shake"
          >
            {error}
          </div>
        )}

        {/* Numeric keypad. `aspect-square` is capped by a max height so the
            grid can't push the Start button off a short (landscape) screen. */}
        <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => appendDigit(d)}
              disabled={submitting}
              style={KEY_STYLE}
              className={`${KEY_BASE} bg-white/10 text-2xl hover:bg-white/20 active:bg-white/30 disabled:opacity-50 sm:text-3xl`}
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={clearCode}
            disabled={submitting || code.length === 0}
            style={KEY_STYLE}
            className={`${KEY_BASE} bg-white/5 text-sm uppercase tracking-wide hover:bg-white/15 active:bg-white/25 disabled:opacity-40 sm:text-base`}
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => appendDigit('0')}
            disabled={submitting}
            style={KEY_STYLE}
            className={`${KEY_BASE} bg-white/10 text-2xl hover:bg-white/20 active:bg-white/30 disabled:opacity-50 sm:text-3xl`}
          >
            0
          </button>
          <button
            type="button"
            onClick={backspace}
            disabled={submitting || code.length === 0}
            style={KEY_STYLE}
            className={`${KEY_BASE} bg-white/5 text-2xl hover:bg-white/15 active:bg-white/25 disabled:opacity-40`}
            aria-label="Backspace"
          >
            ⌫
          </button>
        </div>

        <button
          type="button"
          onClick={submitCode}
          disabled={!canSubmit}
          style={{ touchAction: 'manipulation' }}
          className={`mt-6 w-full rounded-2xl bg-emerald-500 px-6 py-4 text-lg font-black uppercase tracking-wide transition-colors hover:bg-emerald-400 active:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40 sm:mt-8 sm:py-5 sm:text-xl ${
            canSubmit ? 'anim-breathe' : ''
          }`}
        >
          {submitting ? 'Checking…' : 'Start'}
        </button>

        <p className="mt-4 text-xs text-slate-400">
          You can also type the code on a keyboard — Enter to start.
        </p>
      </div>
    </div>
  );
}
