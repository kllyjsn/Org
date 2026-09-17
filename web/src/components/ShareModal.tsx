import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Link2, Trash2, X } from 'lucide-react';
import { api } from '../api';
import type { ShareLink } from '../types';
import { useFocusTrap } from '../lib/useFocusTrap';

export default function ShareModal({
  mapId,
  onClose,
}: {
  mapId: string;
  onClose: () => void;
}) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [label, setLabel] = useState('');
  const [expiry, setExpiry] = useState<string>('never');
  const [passcode, setPasscode] = useState('');
  const [emails, setEmails] = useState('');
  const [newUrl, setNewUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);

  const refresh = useCallback(
    () => api.listShares(mapId).then((r) => setLinks(r.links)),
    [mapId]
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async () => {
    setBusy(true);
    setError('');
    setNewUrl(null);
    try {
      const allowedEmails = emails
        .split(/[\s,]+/)
        .map((email) => email.trim())
        .filter(Boolean);
      const { token } = await api.createShare(mapId, {
        expiresInDays: expiry === 'never' ? undefined : Number(expiry),
        passcode: passcode.trim() || undefined,
        allowedEmails: allowedEmails.length ? allowedEmails : undefined,
        label: label.trim() || undefined,
      });
      setNewUrl(`${window.location.origin}/s/${token}`);
      setLabel('');
      setPasscode('');
      setEmails('');
      void refresh();
    } catch {
      setError('Could not create the link — try again.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (!window.confirm('Revoke this share link? Anyone holding it loses access.')) {
      return;
    }
    setError('');
    try {
      await api.deleteShare(mapId, id);
      void refresh();
    } catch {
      setError('Could not revoke the link — try again.');
    }
  };

  const copy = async () => {
    if (!newUrl) return;
    try {
      await navigator.clipboard.writeText(newUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Copy failed — select the link text manually.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Share this account</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <p className="mb-4 text-sm text-slate-500">
          Live read-only view of the whole account — canvas, roster, briefing,
          strategy, initiatives and history. Viewers can&apos;t edit, comment,
          or use the analyst.
        </p>

        <div className="space-y-2">
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Label (optional — e.g. For champion)"
            value={label}
            maxLength={80}
            onChange={(e) => setLabel(e.target.value)}
          />
          <div className="flex gap-2">
            <select
              className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            >
              <option value="never">Never expires</option>
              <option value="1">Expires in 1 day</option>
              <option value="7">Expires in 7 days</option>
              <option value="30">Expires in 30 days</option>
            </select>
            <input
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Optional passcode (6+ chars)"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
            />
          </div>
          <textarea
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            rows={2}
            placeholder="Restrict to these emails (optional)"
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
          />
          <p className="text-xs text-slate-400">
            Viewers must sign in to TopDown with one of these addresses.
          </p>
          <button
            onClick={() => void create()}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            <Link2 size={15} /> {busy ? 'Creating…' : 'Create link'}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}

        {newUrl && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <p className="break-all text-xs font-medium text-emerald-900">
              {newUrl}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={() => void copy()}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <span className="text-[11px] text-emerald-800">
                Copy it now — for security this link is only shown once.
              </span>
            </div>
          </div>
        )}

        <ul className="mt-4 space-y-2">
          {links.map((l) => (
            <li
              key={l.id}
              className="rounded-lg border border-slate-200 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm font-medium text-slate-700">
                  {l.label || 'Untitled link'}
                </span>
                <button
                  onClick={() => void revoke(l.id)}
                  className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                  title="Revoke"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
                {l.has_passcode && (
                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-500">
                    Passcode
                  </span>
                )}
                {l.allowed_emails && l.allowed_emails.length > 0 && (
                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-500">
                    {l.allowed_emails.length}{' '}
                    {l.allowed_emails.length === 1 ? 'person' : 'people'}
                  </span>
                )}
                <span>
                  {l.expires_at
                    ? `expires ${new Date(l.expires_at).toLocaleDateString()}`
                    : 'no expiry'}
                </span>
                <span>·</span>
                <span>
                  {l.view_count > 0
                    ? `viewed ${l.view_count}× · last ${new Date(
                        l.last_viewed_at ?? l.created_at
                      ).toLocaleDateString()}`
                    : 'never viewed'}
                </span>
              </div>
            </li>
          ))}
          {links.length === 0 && (
            <li className="py-2 text-center text-xs text-slate-400">
              No links yet.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
