import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Wordmark } from '../components/Wordmark';
import { api } from '../api';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useSession } from '../store';

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const load = useSession((s) => s.load);
  const [state, setState] = useState<'pending' | 'ok' | 'failed'>('pending');
  const attempted = useRef(false);
  useDocumentTitle('Verify email — TopDown');

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;
    api
      .confirmEmailVerification(token)
      .then(() => {
        setState('ok');
        // Refresh the session user so emailVerified flips immediately.
        void load();
      })
      .catch(() => setState('failed'));
  }, [token, load]);

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

  if (!token || state === 'failed') {
    return wrap(
      <>
        <h1 className="mb-2 text-lg font-semibold text-slate-950">
          This link isn't valid
        </h1>
        <p className="mb-6 text-sm text-slate-600">
          The verification link is missing, expired, or already used. You can
          request a fresh one from your dashboard.
        </p>
        <Link
          to="/app"
          className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Go to dashboard
        </Link>
      </>
    );
  }

  if (state === 'pending') {
    return wrap(
      <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
    );
  }

  return wrap(
    <>
      <h1 className="mb-2 text-lg font-semibold text-slate-950">
        Email verified
      </h1>
      <p className="mb-6 text-sm text-slate-600">
        Your address is confirmed — you're all set.
      </p>
      <Link
        to="/app"
        className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
      >
        Go to dashboard
      </Link>
    </>
  );
}
