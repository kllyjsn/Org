import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Link2, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useFocusTrap } from '../lib/useFocusTrap';
import type { ShareLink } from '../types';

export default function ShareModal({
  mapId,
  onClose,
}: {
  mapId: string;
  onClose: () => void;
}) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [expiry, setExpiry] = useState<string>('never');
  const [copied, setCopied] = useState<string | null>(null);
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
    const days = expiry === 'never' ? undefined : Number(expiry);
    setBusy(true);
    setError('');
    try {
      await api.createShare(mapId, days);
      void refresh();
    } catch {
      setError('Could not create the link — try again.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: string) => {
    if (!window.confirm('Revoke this share link? Anyone holding it loses access.')) {
      return;
    }
    setError('');
    try {
      await api.deleteShare(mapId, token);
      void refresh();
    } catch {
      setError('Could not revoke the link — try again.');
    }
  };

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/s/${token}`
      );
      setCopied(token);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setError('Copy failed — select the link text manually.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-modal-title"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 id="share-modal-title" className="text-lg font-semibold">
            Share this map
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <p className="mb-4 text-sm text-slate-500">
          Live read-only link — viewers always see the current chart. Send to a
          champion so they can sanity-check it with you.
        </p>

        <div className="flex gap-2">
          <select
            aria-label="Link expiry"
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
          >
            <option value="never">Never expires</option>
            <option value="7">Expires in 7 days</option>
            <option value="30">Expires in 30 days</option>
          </select>
          <button
            onClick={() => void create()}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            <Link2 size={15} /> {busy ? 'Creating…' : 'Create link'}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}

        <ul className="mt-4 space-y-2">
          {links.map((l) => (
            <li
              key={l.token}
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2"
            >
              <span className="flex-1 truncate text-xs text-slate-500">
                /s/{l.token}
                {l.expires_at && (
                  <span className="ml-1 text-slate-400">
                    · expires {new Date(l.expires_at).toLocaleDateString()}
                  </span>
                )}
              </span>
              <button
                onClick={() => void copy(l.token)}
                className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                title="Copy link"
              >
                {copied === l.token ? (
                  <Check size={14} className="text-emerald-500" />
                ) : (
                  <Copy size={14} />
                )}
              </button>
              <button
                onClick={() => void revoke(l.token)}
                className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                title="Revoke"
              >
                <Trash2 size={14} />
              </button>
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
