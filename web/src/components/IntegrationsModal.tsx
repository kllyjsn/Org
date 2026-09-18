import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, Loader2, PlugZap, RefreshCw, Unplug, X } from 'lucide-react';
import { api, ApiError } from '../api';
import { useFocusTrap } from '../lib/useFocusTrap';
import type { IntegrationStatus, IntegrationSyncResult } from '../types';

const ENV_HINTS: Record<string, string> = {
  google: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET',
  microsoft: 'MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET',
};

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function IntegrationsModal({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const [providers, setProviders] = useState<IntegrationStatus[] | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'connect' | 'sync' | 'disconnect' | null>(null);
  const [syncResult, setSyncResult] = useState<Record<string, IntegrationSyncResult>>({});
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);

  const refresh = useCallback(async () => {
    try {
      const { providers } = await api.listIntegrations(workspaceId);
      setProviders(providers);
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err instanceof ApiError ? err.message : 'Could not load integrations.',
      });
      setProviders([]);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // OAuth redirect lands back on /app with ?integration&connected|error.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const provider = params.get('integration');
    if (!provider) return;
    if (params.get('connected') === '1') {
      setNotice({
        kind: 'ok',
        text: `${provider === 'google' ? 'Google' : 'Microsoft'} connected — the first sync is running.`,
      });
    } else if (params.get('error') === '1') {
      setNotice({
        kind: 'error',
        text: 'Connection failed — try connecting again.',
      });
    }
    params.delete('integration');
    params.delete('connected');
    params.delete('error');
    const rest = params.toString();
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${rest ? `?${rest}` : ''}`
    );
  }, []);

  const run = async (
    provider: string,
    action: 'connect' | 'sync' | 'disconnect',
    fn: () => Promise<unknown>
  ) => {
    if (busyProvider) return;
    setBusyProvider(provider);
    setBusyAction(action);
    setNotice(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err instanceof ApiError ? err.message : 'Request failed — try again.',
      });
    } finally {
      setBusyProvider(null);
      setBusyAction(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="integrations-modal-title"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 id="integrations-modal-title" className="text-lg font-semibold text-slate-900">
            Calendar & email sync
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <p className="mb-4 text-xs text-slate-500">
          Connect your calendar and mailbox to mark who you&apos;ve actually met
          and when the last touch was.
        </p>

        {notice && (
          <p
            role="status"
            className={`mb-3 rounded-lg px-3 py-2 text-xs ${
              notice.kind === 'ok'
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-rose-50 text-rose-700'
            }`}
          >
            {notice.text}
          </p>
        )}

        {providers === null ? (
          <div className="flex justify-center py-8 text-slate-400">
            <Loader2 className="animate-spin" />
          </div>
        ) : (
          <ul className="space-y-3">
            {providers.map((provider) => {
              const busy = busyProvider === provider.id;
              const connection = provider.connection;
              const result = syncResult[provider.id];
              return (
                <li
                  key={provider.id}
                  className="rounded-xl border border-slate-200 p-3.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#eeecff] text-[#5b4cf0]">
                        <CalendarDays size={15} />
                      </span>
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          {provider.label}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {!provider.configured ? (
                            <>Not configured — set {ENV_HINTS[provider.id]}</>
                          ) : connection ? (
                            <>
                              {connection.accountEmail ?? 'connected'}
                              {connection.status === 'error' && (
                                <span className="text-rose-600">
                                  {' '}· sync error{connection.lastError ? `: ${connection.lastError}` : ''}
                                </span>
                              )}
                            </>
                          ) : (
                            'Not connected'
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {provider.configured && !connection && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run(provider.id, 'connect', async () => {
                              const { url } = await api.connectIntegration(
                                workspaceId,
                                provider.id
                              );
                              window.location.assign(url);
                            })
                          }
                          className="flex items-center gap-1.5 rounded-lg bg-[#5b4cf0] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#6b5cf8] disabled:opacity-60"
                        >
                          {busy && busyAction === 'connect' ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <PlugZap size={12} />
                          )}
                          Connect
                        </button>
                      )}
                      {provider.configured && connection && (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void run(provider.id, 'sync', async () => {
                                const res = await api.syncIntegration(
                                  connection.id
                                );
                                setSyncResult((prev) => ({
                                  ...prev,
                                  [provider.id]: res,
                                }));
                              })
                            }
                            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-300 disabled:opacity-60"
                          >
                            {busy && busyAction === 'sync' ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <RefreshCw size={12} />
                            )}
                            Sync now
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Disconnect ${provider.label}? Past touches stay on the map.`
                                )
                              ) {
                                void run(provider.id, 'disconnect', () =>
                                  api.disconnectIntegration(connection.id)
                                );
                              }
                            }}
                            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:border-rose-200 hover:text-rose-600 disabled:opacity-60"
                          >
                            <Unplug size={12} />
                            Disconnect
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {connection && (
                    <div className="mt-2 text-[11px] text-slate-400">
                      Last synced {relativeTime(connection.lastSyncedAt)}
                      {result &&
                        ` · ${result.touchpoints} new touchpoints, ${result.peopleUpdated} people updated across ${result.maps} maps`}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
