import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Wordmark } from '../components/Wordmark';
import { api, ApiError } from '../api';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDocumentTitle('Reset password — TopDown');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-[#f6f7f2] p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-xl">
        <div className="mb-6 flex justify-center">
          <Wordmark size="md" />
        </div>
        {sent ? (
          <>
            <h1 className="mb-2 text-lg font-semibold text-slate-950">
              Check your email
            </h1>
            <p className="mb-6 text-sm text-slate-600">
              If an account exists for{' '}
              <span className="font-medium text-slate-700">{email}</span>, we
              sent a password reset link. It expires in 30 minutes.
            </p>
            <Link
              to="/login"
              className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <h1 className="mb-2 text-lg font-semibold text-slate-950">
              Reset your password
            </h1>
            <p className="mb-5 text-sm text-slate-500">
              Enter your work email and we'll send you a reset link.
            </p>
            <form onSubmit={submit} className="space-y-3">
              <input
                aria-label="Work email"
                autoComplete="email"
                autoFocus
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#5b4cf0] focus:ring-4 focus:ring-[#5b4cf0]/10"
                placeholder="Work email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
              <Link
                to="/login"
                className="block text-sm font-medium text-slate-500 hover:text-slate-800"
              >
                Back to sign in
              </Link>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
