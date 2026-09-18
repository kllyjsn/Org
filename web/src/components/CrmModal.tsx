import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Building2,
  Download,
  FileUp,
  Loader2,
  Upload,
  X,
} from 'lucide-react';
import { api, ApiError } from '../api';
import type {
  CrmAccount,
  CrmOpportunity,
  CrmStatus,
  MapState,
} from '../types';
import { motion } from 'framer-motion';
import { useFocusTrap } from '../lib/useFocusTrap';

interface Props {
  mapId: string;
  workspaceId: string;
  readOnly: boolean;
  onApply: (state: MapState) => void;
  onClose: () => void;
  /** Reuse of the old "Import CRM" CSV path, now inside the modal. */
  onCsvImport: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

function fmtAmount(amount: number | null): string {
  if (amount === null || Number.isNaN(amount)) return '';
  return `$${amount.toLocaleString()}`;
}

export default function CrmModal({
  mapId,
  workspaceId: _workspaceId,
  readOnly,
  onApply,
  onClose,
  onCsvImport,
}: Props) {
  const [status, setStatus] = useState<CrmStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [accounts, setAccounts] = useState<CrmAccount[] | null>(null);
  const [integrationId, setIntegrationId] = useState<string | null>(null);
  const [account, setAccount] = useState<CrmAccount | null>(null);
  const [opportunities, setOpportunities] = useState<CrmOpportunity[] | null>(
    null
  );
  const [createUnmatched, setCreateUnmatched] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const csvInput = useRef<HTMLInputElement | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    try {
      setStatus(await api.crmStatus(mapId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load');
    }
  }, [mapId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const connection =
    status?.connections.find((conn) => conn.provider === status.crm?.provider) ??
    status?.connections.find((conn) => conn.provider === 'hubspot') ??
    status?.connections[0] ??
    null;

  useEffect(() => {
    if (connection && status && !status.crm) setIntegrationId(connection.id);
  }, [connection, status]);

  useEffect(() => {
    if (!integrationId || status?.crm) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      api
        .crmSearchAccounts(integrationId, query)
        .then((res) => setAccounts(res.accounts))
        .catch(() => setAccounts([]));
    }, 300);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, integrationId, status?.crm]);

  async function pickAccount(next: CrmAccount) {
    if (!integrationId) return;
    setAccount(next);
    setAccounts(null);
    try {
      const res = await api.crmListOpportunities(integrationId, next.id);
      setOpportunities(res.opportunities);
    } catch {
      setOpportunities([]);
    }
  }

  async function link(opportunity: CrmOpportunity | null) {
    if (!account || !integrationId) return;
    setBusy('link');
    try {
      const res = await api.crmLink(mapId, {
        integrationId,
        accountId: account.id,
        accountName: account.name,
        opportunityId: opportunity?.id,
        opportunityName: opportunity?.name,
        stage: opportunity?.stage ?? undefined,
        amount: opportunity?.amount ?? undefined,
        closeDate: opportunity?.closeDate ?? undefined,
      });
      onApply(res.state);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Link failed');
    } finally {
      setBusy(null);
    }
  }

  async function pull() {
    setBusy('pull');
    setResult(null);
    try {
      const res = await api.crmPull(mapId, createUnmatched);
      onApply(res.state);
      setResult(
        `Pulled: ${res.matched} matched, ${res.created} created, ${res.updated} updated.`
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Pull failed');
    } finally {
      setBusy(null);
    }
  }

  async function push() {
    setBusy('push');
    setResult(null);
    try {
      const res = await api.crmPush(mapId);
      onApply(res.state);
      setResult(
        res.failed.length === 0
          ? `Pushed ${res.pushed} contact${res.pushed === 1 ? '' : 's'}.`
          : `Pushed ${res.pushed}, failed ${res.failed.length}: ${res.failed
              .map((f) => f.error)
              .join('; ')}`
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Push failed');
    } finally {
      setBusy(null);
    }
  }

  const link_ = status?.crm ?? null;

  const trapRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(trapRef);

  return (
    <motion.div
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 backdrop-blur-sm sm:items-center sm:p-6"
    >
      <motion.div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="crm-modal-title"
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-y-auto rounded-t-3xl bg-[#f9faf7] shadow-2xl sm:rounded-3xl"
      >
        <div className="flex items-start justify-between border-b border-slate-200/80 px-5 py-4">
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[.16em] text-[#5b4cf0]">
              CRM
            </div>
            <h2
              id="crm-modal-title"
              className="text-lg font-semibold tracking-tight text-slate-950"
            >
              HubSpot & Salesforce sync
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close CRM"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm hover:text-slate-700"
          >
            <X size={15} />
          </button>
        </div>
      <div className="flex flex-col gap-4 p-5">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </div>
        )}
        {status === null ? (
          <Loader2 className="animate-spin text-slate-400" size={18} />
        ) : status.connections.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-slate-600">
              Connect HubSpot or Salesforce in Integrations to pull contacts
              into this map and push roles & stance back.
            </p>
            <a
              href="/app?open=integrations"
              className="inline-flex w-fit items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Open Integrations
            </a>
          </div>
        ) : !link_ ? (
          account ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                <Building2 size={15} className="text-slate-400" />
                {account.name}
                {account.domain && (
                  <span className="text-xs font-normal text-slate-400">
                    {account.domain}
                  </span>
                )}
                <button
                  className="ml-auto text-xs text-slate-400 hover:text-slate-600"
                  onClick={() => {
                    setAccount(null);
                    setOpportunities(null);
                  }}
                >
                  Back
                </button>
              </div>
              <p className="text-xs text-slate-500">
                Optionally pick an open opportunity to track:
              </p>
              <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {(opportunities ?? []).map((opp) => (
                  <button
                    key={opp.id}
                    disabled={busy !== null || readOnly}
                    onClick={() => void link(opp)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="font-medium text-slate-800">
                      {opp.name}
                    </span>
                    {opp.stage && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                        {opp.stage}
                      </span>
                    )}
                    {fmtAmount(opp.amount) && (
                      <span className="text-xs text-slate-400">
                        {fmtAmount(opp.amount)}
                      </span>
                    )}
                  </button>
                ))}
                {opportunities !== null && opportunities.length === 0 && (
                  <div className="px-3 py-2 text-xs text-slate-400">
                    No open opportunities.
                  </div>
                )}
              </div>
              <button
                disabled={busy !== null || readOnly}
                onClick={() => void link(null)}
                className="w-fit text-xs font-medium text-indigo-600 hover:text-indigo-800"
              >
                {busy === 'link' ? 'Linking…' : 'Link account only'}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search CRM accounts…"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
              />
              <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {(accounts ?? []).map((acc) => (
                  <button
                    key={acc.id}
                    onClick={() => void pickAccount(acc)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    <Building2 size={14} className="text-slate-400" />
                    <span className="font-medium text-slate-800">
                      {acc.name}
                    </span>
                    {acc.domain && (
                      <span className="text-xs text-slate-400">
                        {acc.domain}
                      </span>
                    )}
                  </button>
                ))}
                {accounts !== null && accounts.length === 0 && (
                  <div className="px-3 py-2 text-xs text-slate-400">
                    No accounts found.
                  </div>
                )}
              </div>
            </div>
          )
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Building2 size={15} className="text-slate-400" />
                {link_.accountName}
                <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
                  {link_.provider}
                </span>
              </div>
              {link_.opportunityName && (
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                  {link_.opportunityName}
                  {link_.stage && <span>· {link_.stage}</span>}
                  {link_.amount !== null && (
                    <span>· {fmtAmount(link_.amount)}</span>
                  )}
                  {link_.closeDate && <span>· closes {link_.closeDate}</span>}
                </div>
              )}
              <div className="mt-1 text-[10px] text-slate-400">
                {link_.lastPulledAt && `pulled ${link_.lastPulledAt}`}
                {link_.lastPulledAt && link_.lastPushedAt && ' · '}
                {link_.lastPushedAt && `pushed ${link_.lastPushedAt}`}
              </div>
            </div>
            {!readOnly && (
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={createUnmatched}
                    onChange={(e) => setCreateUnmatched(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Create people not on the map
                </label>
                <div className="flex gap-2">
                  <button
                    disabled={busy !== null}
                    onClick={() => void pull()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {busy === 'pull' ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Download size={13} />
                    )}
                    Pull contacts
                  </button>
                  <button
                    disabled={busy !== null}
                    onClick={() => void push()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {busy === 'push' ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Upload size={13} />
                    )}
                    Push roles & stance
                  </button>
                  <button
                    disabled={busy !== null}
                    onClick={async () => {
                      setBusy('unlink');
                      try {
                        const res = await api.crmUnlink(mapId);
                        onApply(res.state);
                        setAccount(null);
                        setOpportunities(null);
                        await reload();
                      } finally {
                        setBusy(null);
                      }
                    }}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-600"
                  >
                    <X size={13} />
                    Unlink
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {result && <p className="text-xs text-slate-500">{result}</p>}
        <div className="border-t border-slate-100 pt-3">
          <button
            onClick={() => csvInput.current?.click()}
            disabled={readOnly}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
          >
            <FileUp size={13} />
            Import CSV
          </button>
          <input
            ref={csvInput}
            type="file"
            accept=".csv,text/csv"
            aria-label="Import CRM CSV"
            className="hidden"
            onChange={onCsvImport}
          />
        </div>
      </div>
      </motion.div>
    </motion.div>
  );
}
