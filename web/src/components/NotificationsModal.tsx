import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BellRing,
  Loader2,
  Mail,
  Send,
  Slack,
  Trash2,
  X,
} from 'lucide-react';
import { api, ApiError } from '../api';
import { useFocusTrap } from '../lib/useFocusTrap';
import type { NotificationsResponse } from '../types';

function when(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const KIND_LABELS: Record<string, string> = {
  change_alert: 'Digest',
  pre_meeting_brief: 'Brief',
  weekly_coverage: 'Weekly',
};

export default function NotificationsModal({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<NotificationsResponse | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [slackUrl, setSlackUrl] = useState('');
  const [slackLabel, setSlackLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);

  const refresh = useCallback(async () => {
    try {
      setData(await api.listNotifications(workspaceId));
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof ApiError ? err.message : 'Could not load settings.',
      });
      setData({
        channels: [],
        prefs: { notifyEmail: true, notifyBriefs: true },
        emailConfigured: false,
        encryptionConfigured: false,
        recent: [],
      });
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (key: string, fn: () => Promise<unknown>, okText?: string) => {
    if (busy) return;
    setBusy(key);
    setNotice(null);
    try {
      await fn();
      if (okText) setNotice({ ok: true, text: okText });
      await refresh();
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof ApiError ? err.message : 'Request failed.',
      });
    } finally {
      setBusy(null);
    }
  };

  const addSlack = () =>
    run(
      'add-slack',
      async () => {
        await api.addSlackChannel(workspaceId, slackUrl.trim(), slackLabel.trim());
        setSlackUrl('');
        setSlackLabel('');
      },
      'Slack channel added — send a test to confirm.'
    );

  const slackChannels =
    data?.channels.filter((channel) => channel.kind === 'slack_webhook') ?? [];
  const hasEmailChannel = data?.channels.some((c) => c.kind === 'email') ?? false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notifications-modal-title"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 id="notifications-modal-title" className="text-lg font-semibold text-slate-900">
            Notifications
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <p className="mb-4 text-xs text-slate-500">
          Change digests, pre-meeting briefs, and a weekly coverage roll-up —
          where you already work.
        </p>

        {notice && (
          <p
            role="status"
            className={`mb-3 rounded-lg px-3 py-2 text-xs ${
              notice.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
            }`}
          >
            {notice.text}
          </p>
        )}

        {data === null ? (
          <div className="flex justify-center py-8 text-slate-400">
            <Loader2 className="animate-spin" />
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Slack size={12} /> Slack
              </h3>
              <ul className="space-y-2">
                {slackChannels.map((channel) => (
                  <li
                    key={channel.id}
                    className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-800">
                        {channel.label || channel.targetHint}
                      </div>
                      <div className="truncate text-[11px] text-slate-400">
                        {channel.targetHint}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={busy === `toggle-${channel.id}`}
                      onClick={() =>
                        void run(`toggle-${channel.id}`, () =>
                          api.setNotificationChannelEnabled(
                            workspaceId,
                            channel.id,
                            !channel.enabled
                          )
                        )
                      }
                      className={`h-5 w-9 rounded-full transition ${
                        channel.enabled ? 'bg-[#5b4cf0]' : 'bg-slate-200'
                      }`}
                      aria-label={channel.enabled ? 'Disable' : 'Enable'}
                    >
                      <span
                        className={`block h-4 w-4 translate-x-[2px] rounded-full bg-white transition ${
                          channel.enabled ? 'translate-x-[18px]' : ''
                        }`}
                      />
                    </button>
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() =>
                        void run(
                          `test-${channel.id}`,
                          () => api.testNotificationChannel(workspaceId, channel.id),
                          'Test sent.'
                        )
                      }
                      className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:border-slate-300 disabled:opacity-50"
                      aria-label="Send test"
                    >
                      {busy === `test-${channel.id}` ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Send size={12} />
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() =>
                        void run(`rm-${channel.id}`, () =>
                          api.removeNotificationChannel(workspaceId, channel.id)
                        )
                      }
                      className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:border-rose-200 hover:text-rose-600 disabled:opacity-50"
                      aria-label="Remove channel"
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
              {data.encryptionConfigured ? (
                <div className="mt-2 space-y-2">
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                    placeholder="Channel label (optional)"
                    value={slackLabel}
                    onChange={(e) => setSlackLabel(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <input
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                      placeholder="https://hooks.slack.com/services/…"
                      value={slackUrl}
                      onChange={(e) => setSlackUrl(e.target.value)}
                      aria-label="Slack webhook URL"
                    />
                    <button
                      type="button"
                      disabled={busy === 'add-slack' || !slackUrl.trim()}
                      onClick={() => void addSlack()}
                      className="rounded-lg bg-[#5b4cf0] px-3 py-2 text-xs font-semibold text-white hover:bg-[#6b5cf8] disabled:opacity-60"
                    >
                      {busy === 'add-slack' ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        'Add'
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-slate-400">
                  Set INTEGRATION_ENCRYPTION_KEY to enable Slack webhooks.
                </p>
              )}
            </section>

            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Mail size={12} /> Email
              </h3>
              {data.emailConfigured ? (
                <div className="space-y-2">
                  {!hasEmailChannel && (
                    <button
                      type="button"
                      disabled={busy === 'add-email'}
                      onClick={() =>
                        void run('add-email', () => api.addEmailChannel(workspaceId))
                      }
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-300 disabled:opacity-50"
                    >
                      Enable workspace email channel
                    </button>
                  )}
                  {(
                    [
                      ['notifyEmail', 'Email me change digests'],
                      ['notifyBriefs', 'Email me pre-meeting briefs'],
                    ] as const
                  ).map(([key, label]) => (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                    >
                      {label}
                      <input
                        type="checkbox"
                        className="accent-[#5b4cf0]"
                        checked={data.prefs[key]}
                        disabled={!!busy}
                        onChange={(e) =>
                          void run(`pref-${key}`, () =>
                            api.updateNotificationPrefs(workspaceId, {
                              [key]: e.target.checked,
                            })
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-slate-400">
                  Set RESEND_API_KEY to enable email digests and briefs.
                </p>
              )}
            </section>

            {data.recent.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <BellRing size={12} /> Recent
                </h3>
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {data.recent.map((row, index) => (
                    <li
                      key={index}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <span className="mr-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                          {KIND_LABELS[row.kind] ?? row.kind}
                        </span>
                        <span className="text-slate-700">{row.title}</span>
                      </div>
                      <span
                        className={
                          row.sentAt
                            ? 'text-emerald-600'
                            : row.lastError
                              ? 'text-rose-600'
                              : 'text-slate-400'
                        }
                      >
                        {row.sentAt
                          ? `sent ${when(row.sentAt)}`
                          : (row.lastError ?? 'queued')}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
