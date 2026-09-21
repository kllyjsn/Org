import { useEffect, useRef, useState } from 'react';
import {
  Copy,
  ExternalLink,
  Loader2,
  Mail,
  RefreshCw,
  Send,
} from 'lucide-react';
import { api } from '../api';
import { useFocusTrap } from '../lib/useFocusTrap';
import type { OutreachDraft, Person } from '../types';

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => undefined);
      }}
      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
    >
      <Copy size={11} />
      {copied ? 'Copied' : label}
    </button>
  );
}

export default function OutreachModal({
  mapId,
  person,
  onClose,
}: {
  mapId: string;
  person: Person;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<OutreachDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);

  const generate = () => {
    setLoading(true);
    setError('');
    api
      .draftOutreach(mapId, person.id)
      .then((r) => setDraft(r.draft))
      .catch(() => setError('Could not draft outreach — try again.'))
      .finally(() => setLoading(false));
  };

  useEffect(generate, [mapId, person.id]);

  const mailto = person.email
    ? `mailto:${person.email}?subject=${encodeURIComponent(draft?.subject ?? '')}&body=${encodeURIComponent(draft?.emailBody ?? '')}`
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="outreach-modal-title"
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="mb-1 flex items-start justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#5b4cf0]">
              Outreach draft
            </div>
            <h2
              id="outreach-modal-title"
              className="text-lg font-semibold tracking-tight"
            >
              {person.name}
            </h2>
            <p className="text-xs text-slate-500">{person.title}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close outreach draft"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-50 text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" />
            Drafting from map evidence…
          </div>
        ) : error ? (
          <p className="py-10 text-center text-sm text-rose-600">{error}</p>
        ) : draft ? (
          <div className="mt-2 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <section className="rounded-xl border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  <Mail size={11} /> Email
                </span>
                <div className="flex gap-1.5">
                  <CopyButton
                    text={`${draft.subject}\n\n${draft.emailBody}`}
                    label="Copy"
                  />
                  {mailto && (
                    <a
                      href={mailto}
                      className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2 py-1 text-[11px] font-medium text-white hover:bg-slate-700"
                    >
                      <Send size={11} /> Send
                    </a>
                  )}
                </div>
              </div>
              <p className="text-xs font-semibold text-slate-800">
                {draft.subject}
              </p>
              <p className="mt-1.5 whitespace-pre-wrap text-xs leading-5 text-slate-600">
                {draft.emailBody}
              </p>
            </section>

            <section className="rounded-xl border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  LinkedIn note
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-400">
                    {draft.linkedinNote.length}/280
                  </span>
                  <CopyButton text={draft.linkedinNote} label="Copy" />
                  {person.linkedin && (
                    <a
                      href={person.linkedin}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                    >
                      <ExternalLink size={11} /> Profile
                    </a>
                  )}
                </div>
              </div>
              <p className="text-xs leading-5 text-slate-600">
                {draft.linkedinNote}
              </p>
            </section>

            {draft.talkingPoints.length > 0 && (
              <section className="rounded-xl border border-slate-200 p-3">
                <span className="mb-2 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Call prep
                </span>
                <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-slate-600">
                  {draft.talkingPoints.map((point, index) => (
                    <li key={index}>{point}</li>
                  ))}
                </ul>
              </section>
            )}

            {draft.evidence.length > 0 && (
              <section>
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Grounded in
                </span>
                <ul className="space-y-1">
                  {draft.evidence.map((url) => (
                    <li key={url}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-[11px] text-indigo-600 hover:underline"
                      >
                        {url.replace(/^https?:\/\/(www\.)?/, '')}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
          <span className="text-[10px] text-slate-400">
            {draft?.provider === 'template'
              ? 'Template draft — configure an LLM key for tailored copy'
              : `Generated by ${draft?.provider ?? '…'} — review before sending`}
          </span>
          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={12} /> Regenerate
          </button>
        </div>
      </div>
    </div>
  );
}
