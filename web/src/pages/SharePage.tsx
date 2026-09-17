import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2, Lock } from 'lucide-react';
import { Wordmark } from '../components/Wordmark';
import { api, ApiError } from '../api';
import type { ShareAccess } from '../types';
import MapPage from './MapPage';

type Gate =
  | { kind: 'loading' }
  | { kind: 'passcode'; locked?: false }
  | { kind: 'locked'; retryAfterSec: number }
  | { kind: 'login' }
  | { kind: 'not_allowed' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; access: ShareAccess };

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const [gate, setGate] = useState<Gate>({ kind: 'loading' });
  const [passcode, setPasscode] = useState('');
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  const attempt = useCallback(
    (code?: string) => {
      if (!token) return;
      setBusy(true);
      api
        .shareAccess(token, code)
        .then((access) => setGate({ kind: 'ok', access }))
        .catch((err) => {
          if (err instanceof ApiError) {
            const requires = err.data.requires;
            if (err.status === 429) {
              setGate({
                kind: 'locked',
                retryAfterSec:
                  typeof err.data.retryAfterSec === 'number'
                    ? err.data.retryAfterSec
                    : 900,
              });
            } else if (requires === 'passcode') {
              setAttemptsLeft(
                typeof err.data.attemptsLeft === 'number'
                  ? err.data.attemptsLeft
                  : null
              );
              setGate({ kind: 'passcode' });
            } else if (requires === 'login') {
              setGate({ kind: 'login' });
            } else if (err.status === 403) {
              setGate({ kind: 'not_allowed' });
            } else {
              setGate({ kind: 'error', message: err.message });
            }
          } else {
            setGate({ kind: 'error', message: 'could not open this link' });
          }
        })
        .finally(() => setBusy(false));
    },
    [token]
  );

  useEffect(() => {
    attempt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (gate.kind === 'ok') {
    return <MapPage shareMapId={gate.access.mapId} />;
  }

  if (gate.kind === 'loading') {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  const loginLink = `/login?next=${encodeURIComponent(`/s/${token ?? ''}`)}`;

  return (
    <div className="flex h-full flex-col items-center justify-center bg-[#f6f7f2] px-4">
      <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-[0_28px_90px_rgba(15,23,42,.12)] sm:p-8">
        <div className="mb-5 flex justify-center">
          <Wordmark size="md" />
        </div>

        {gate.kind === 'passcode' && (
          <>
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#eeecff] text-[#5b4cf0]">
              <Lock size={18} />
            </div>
            <h1 className="text-xl font-semibold text-slate-950">
              This account view is protected
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">
              Enter the passcode you were given.
            </p>
            <form
              className="mt-4 space-y-2.5"
              onSubmit={(event) => {
                event.preventDefault();
                setAttemptsLeft(null);
                attempt(passcode);
              }}
            >
              <input
                type="password"
                autoFocus
                value={passcode}
                onChange={(event) => setPasscode(event.target.value)}
                placeholder="Passcode"
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-[#5b4cf0] focus:ring-4 focus:ring-[#5b4cf0]/10"
              />
              {attemptsLeft !== null && (
                <p className="text-xs text-rose-600">
                  Incorrect passcode — {attemptsLeft}{' '}
                  {attemptsLeft === 1 ? 'attempt' : 'attempts'} left.
                </p>
              )}
              <button
                type="submit"
                disabled={busy || !passcode}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#5b4cf0] px-4 py-3 text-sm font-semibold text-white hover:bg-[#4b3ddd] disabled:opacity-60"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                Continue
              </button>
            </form>
          </>
        )}

        {gate.kind === 'locked' && (
          <>
            <h1 className="text-xl font-semibold text-slate-950">
              Too many attempts
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">
              Too many attempts — try again in{' '}
              {Math.max(1, Math.ceil(gate.retryAfterSec / 60))} minutes.
            </p>
            <input
              disabled
              placeholder="Passcode"
              className="mt-4 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-400"
            />
          </>
        )}

        {gate.kind === 'login' && (
          <>
            <h1 className="text-xl font-semibold text-slate-950">
              This link is restricted to invited people
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">
              Sign in with the email that was invited.
            </p>
            <Link
              to={loginLink}
              className="mt-4 flex w-full items-center justify-center rounded-xl bg-[#5b4cf0] px-4 py-3 text-sm font-semibold text-white hover:bg-[#4b3ddd]"
            >
              Sign in to TopDown
            </Link>
          </>
        )}

        {gate.kind === 'not_allowed' && (
          <>
            <h1 className="text-xl font-semibold text-slate-950">
              Your account isn&apos;t on the invite list for this account view
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">
              Try signing in with a different email.
            </p>
            <Link
              to={loginLink}
              className="mt-4 flex w-full items-center justify-center rounded-xl bg-[#5b4cf0] px-4 py-3 text-sm font-semibold text-white hover:bg-[#4b3ddd]"
            >
              Sign in to TopDown
            </Link>
          </>
        )}

        {gate.kind === 'error' && (
          <div className="text-slate-500">
            <p className="text-lg font-medium">{gate.message}</p>
            <p className="mt-1 text-sm">
              This share link may have been revoked or expired.
            </p>
            <Link
              to="/"
              className="mt-3 inline-block text-sm text-indigo-600 hover:underline"
            >
              TopDown — build your own account maps →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
