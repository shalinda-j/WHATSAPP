import { useCallback, useMemo, useState } from 'react';
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
      const status = errorStatus(err);
      if (status === 404) {
        setError('Invalid or expired code');
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

  const dots = useMemo(
    () => Array.from({ length: CODE_LENGTH }).map((_, i) => i < code.length),
    [code.length],
  );

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
      />
    );
  }

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950 anim-gradient text-white flex flex-col items-center justify-center px-4 py-10">
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

        {/* Numeric keypad */}
        <div className="grid grid-cols-3 gap-3">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => appendDigit(d)}
              disabled={submitting}
              className="aspect-square rounded-2xl bg-white/10 hover:bg-white/20 active:bg-white/30 text-3xl font-bold transition-all hover:-translate-y-0.5 active:scale-95 disabled:opacity-50 disabled:hover:translate-y-0"
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={clearCode}
            disabled={submitting || code.length === 0}
            className="aspect-square rounded-2xl bg-white/5 hover:bg-white/15 active:bg-white/25 text-base font-bold uppercase tracking-wide transition-all hover:-translate-y-0.5 active:scale-95 disabled:opacity-40 disabled:hover:translate-y-0"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => appendDigit('0')}
            disabled={submitting}
            className="aspect-square rounded-2xl bg-white/10 hover:bg-white/20 active:bg-white/30 text-3xl font-bold transition-all hover:-translate-y-0.5 active:scale-95 disabled:opacity-50 disabled:hover:translate-y-0"
          >
            0
          </button>
          <button
            type="button"
            onClick={backspace}
            disabled={submitting || code.length === 0}
            className="aspect-square rounded-2xl bg-white/5 hover:bg-white/15 active:bg-white/25 text-2xl font-bold transition-all hover:-translate-y-0.5 active:scale-95 disabled:opacity-40 disabled:hover:translate-y-0"
            aria-label="Backspace"
          >
            ⌫
          </button>
        </div>

        <button
          type="button"
          onClick={submitCode}
          disabled={!canSubmit}
          className={`mt-8 w-full rounded-2xl bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 px-6 py-5 text-xl font-black uppercase tracking-wide transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            canSubmit ? 'anim-breathe' : ''
          }`}
        >
          {submitting ? 'Checking…' : 'Start'}
        </button>
      </div>
    </div>
  );
}
