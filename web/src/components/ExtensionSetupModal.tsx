import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Copy, Loader2, Puzzle, Trash2, X } from 'lucide-react';
import { api, ApiError } from '../api';
import type { ExtensionToken } from '../api';
import { useFocusTrap } from '../lib/useFocusTrap';

const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) || window.location.origin;

function formatDate(iso: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function ExtensionSetupModal({ onClose }: { onClose: () => void }) {
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);
  const [tokens, setTokens] = useState<ExtensionToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .listExtensionTokens()
      .then((r) => setTokens(r.tokens))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load tokens.')
      )
      .finally(() => setLoading(false));
  }, []);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    setError('');
    try {
      const { token, record } = await api.createExtensionToken(label.trim() || 'Chrome extension');
      setTokens((prev) => [record, ...prev]);
      setFreshToken(token);
      setCopied(false);
      setLabel('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create token.');
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    setError('');
    try {
      await api.revokeExtensionToken(id);
      setTokens((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not revoke token.');
    }
  };

  const copy = async () => {
    if (!freshToken) return;
    await navigator.clipboard.writeText(freshToken);
    setCopied(true);
  };

  return (
    <div
      className="fixed inset-0 z-[75] flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <motion.div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="extension-modal-title"
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 26, stiffness: 260 }}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-[#f9faf7] p-5 shadow-2xl sm:rounded-3xl sm:p-7"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-[#5b4cf0]">
              <Puzzle size={13} />
              Chrome extension
            </div>
            <h2
              id="extension-modal-title"
              className="text-2xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-3xl"
            >
              LinkedIn to roster, one click.
            </h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
              Save the profile you are viewing, or sync a Sales Navigator list,
              into an account roster. Nothing is read from LinkedIn until you
              click.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close extension setup"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm hover:text-slate-700"
          >
            <X size={16} />
          </button>
        </div>

        <ol className="space-y-2 rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm leading-6 text-slate-600">
          <li>
            <span className="font-semibold text-slate-900">1.</span> Build the
            extension with <code className="rounded bg-slate-100 px-1">npm run build -w extension</code>{' '}
            and load <code className="rounded bg-slate-100 px-1">extension/dist</code> via{' '}
            <span className="whitespace-nowrap">chrome://extensions → Load unpacked</span>.
          </li>
          <li>
            <span className="font-semibold text-slate-900">2.</span> Create a
            token below and paste it into the extension popup.
          </li>
          <li>
            <span className="font-semibold text-slate-900">3.</span> In the
            extension options, set the API URL to{' '}
            <code className="break-all rounded bg-slate-100 px-1">{API_URL}</code>.
          </li>
        </ol>

        <div className="mt-5 flex gap-2">
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void create();
            }}
            placeholder="Token label (e.g. Work laptop)"
            aria-label="Token label"
            className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-[#5b4cf0] focus:ring-4 focus:ring-[#5b4cf0]/10"
          />
          <button
            onClick={() => void create()}
            disabled={creating}
            className="flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : null}
            Create token
          </button>
        </div>

        {freshToken && (
          <div className="mt-3 rounded-2xl border border-[#5b4cf0]/30 bg-[#5b4cf0]/5 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[#5b4cf0]">
              Copy now — shown once
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <code
                data-testid="fresh-extension-token"
                className="min-w-0 flex-1 break-all rounded-xl bg-white px-2.5 py-2 text-xs text-slate-900"
              >
                {freshToken}
              </code>
              <button
                onClick={() => void copy()}
                aria-label="Copy token"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm hover:text-slate-900"
              >
                {copied ? <Check size={15} className="text-emerald-600" /> : <Copy size={15} />}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div className="mt-5">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[.14em] text-slate-400">
            Your tokens
          </div>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : tokens.length === 0 ? (
            <p className="text-sm text-slate-500">No tokens yet.</p>
          ) : (
            <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">{t.label}</div>
                    <div className="text-xs text-slate-500">
                      Created {formatDate(t.createdAt)} · last used {formatDate(t.lastUsedAt)}
                    </div>
                  </div>
                  <button
                    onClick={() => void revoke(t.id)}
                    aria-label={`Revoke ${t.label}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </motion.div>
    </div>
  );
}
