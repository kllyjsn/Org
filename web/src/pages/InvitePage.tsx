import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Wordmark } from '../components/Wordmark';
import { api, ApiError } from '../api';
import { useSession } from '../store';
import { useDocumentTitle } from '../lib/useDocumentTitle';

interface InviteInfo {
  email: string;
  workspaceName: string;
  inviterName: string;
  expiresAt: string;
  hasAccount: boolean;
  status: 'ok' | 'expired' | 'accepted';
  accessScope: 'all' | 'selected';
  accountNames: string[];
}

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, loading, load, acceptInvite } = useSession();
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const acceptingRef = useRef(false);
  useDocumentTitle('Workspace invite — TopDown');

  useEffect(() => {
    if (loading) void load();
  }, [loading, load]);

  useEffect(() => {
    if (!token) return;
    api
      .getInvite(token)
      .then(({ invite }) => setInvite(invite))
      .catch(() => setNotFound(true));
  }, [token]);

  // Signed-in user opening an invite for their own account: accept directly.
  useEffect(() => {
    if (!token || !invite || !user) return;
    if (invite.status !== 'ok' || !invite.hasAccount) return;
    if (user.email.toLowerCase() !== invite.email.toLowerCase()) return;
    if (acceptingRef.current) return;
    acceptingRef.current = true;
    void acceptInvite(token)
      .then(() => navigate('/app', { replace: true }))
      .catch(() => {
        acceptingRef.current = false;
      });
  }, [token, invite, user, acceptInvite, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setBusy(true);
    try {
      await acceptInvite(token, { name, password });
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'invite failed');
      setBusy(false);
    }
  };

  const card = (body: React.ReactNode) => (
    <div className="flex min-h-full items-center justify-center bg-[#f6f7f2] p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-xl">
        <div className="mb-6 flex justify-center">
          <Wordmark size="md" />
        </div>
        {body}
      </div>
    </div>
  );

  if (!invite && !notFound) {
    return card(
      <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
    );
  }

  if (notFound || !invite || invite.status !== 'ok') {
    const message = notFound
      ? 'This invite link is not valid.'
      : invite?.status === 'expired'
        ? 'This invite link has expired.'
        : 'This invite has already been accepted.';
    return card(
      <>
        <p className="mb-6 text-sm text-slate-600">{message}</p>
        <Link
          to="/login"
          className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Sign in
        </Link>
      </>
    );
  }

  if (!invite.hasAccount) {
    return card(
      <>
        <h1 className="mb-1 text-lg font-semibold text-slate-950">
          {invite.inviterName} invited you to {invite.workspaceName}
        </h1>
        <p className="mb-5 text-sm text-slate-500">
          Create an account for{' '}
          <span className="font-medium text-slate-700">{invite.email}</span> to
          join.
        </p>
        {invite.accessScope === 'selected' && invite.accountNames.length > 0 && (
          <p className="mb-5 text-sm text-slate-500">
            You'll get access to: {invite.accountNames.join(', ')}
          </p>
        )}
        <form onSubmit={submit} className="space-y-3 text-left">
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            placeholder="Your name"
            aria-label="Your name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            placeholder="Password (8+ characters)"
            aria-label="Password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && (
            <p role="alert" className="text-xs text-rose-600">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {busy ? 'Joining…' : 'Join workspace'}
          </button>
        </form>
      </>
    );
  }

  const signedInAsInvited =
    user && user.email.toLowerCase() === invite.email.toLowerCase();
  return card(
    <>
      <h1 className="mb-1 text-lg font-semibold text-slate-950">
        {invite.inviterName} invited you to {invite.workspaceName}
      </h1>
      <p className="mb-5 text-sm text-slate-500">
        {signedInAsInvited
          ? 'Adding you to the workspace…'
          : `An account already exists for ${invite.email}.`}
      </p>
      {invite.accessScope === 'selected' && invite.accountNames.length > 0 && (
        <p className="mb-5 text-sm text-slate-500">
          You'll get access to: {invite.accountNames.join(', ')}
        </p>
      )}
      {!signedInAsInvited && (
        <button
          onClick={() =>
            navigate(`/login?next=${encodeURIComponent(`/invite/${token}`)}`)
          }
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Sign in as {invite.email} to accept
        </button>
      )}
    </>
  );
}
