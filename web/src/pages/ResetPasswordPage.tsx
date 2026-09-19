import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Wordmark } from '../components/Wordmark';
import { api, ApiError } from '../api';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDocumentTitle('Choose a new password — TopDown');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('passwords do not match');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const wrap = (body: React.ReactNode) => (
    <div className="flex min-h-full items-center justify-center bg-[#f6f7f2] p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-xl">
        <div className="mb-6 flex justify-center">
          <Wordmark size="md" />
        </div>
        {body}
      </div>
    </div>
  );

  if (done) {
    return wrap(
      <>
        <h1 className="mb-2 text-lg font-semibold text-slate-950">
          Password updated
        </h1>
        <p className="mb-6 text-sm text-slate-600">
          Your password was changed and existing sessions were signed out.
        </p>
        <Link
          to="/login"
          className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Sign in
        </Link>
      </>
    );
  }

  return wrap(
    <>
      <h1 className="mb-2 text-lg font-semibold text-slate-950">
        Choose a new password
      </h1>
      {!token ? (
        <>
          <p className="mb-6 text-sm text-slate-600">
            This reset link is missing its token — request a fresh one.
          </p>
          <Link
            to="/forgot-password"
            className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Request reset link
          </Link>
        </>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <input
            aria-label="New password"
            autoComplete="new-password"
            autoFocus
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#5b4cf0] focus:ring-4 focus:ring-[#5b4cf0]/10"
            placeholder="New password (8+ characters)"
            type="password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <input
            aria-label="Confirm password"
            autoComplete="new-password"
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#5b4cf0] focus:ring-4 focus:ring-[#5b4cf0]/10"
            placeholder="Confirm password"
            type="password"
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
          {error && (
            <div
              role="alert"
              className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700"
            >
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-[#5b4cf0] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#4b3ddd] disabled:opacity-60"
          >
            {busy ? 'Updating…' : 'Update password'}
          </button>
        </form>
      )}
    </>
  );
}
