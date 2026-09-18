import { useEffect, useRef, useState } from 'react';
import { Inbox, Loader2, X } from 'lucide-react';
import { api } from '../api';
import { useFocusTrap } from '../lib/useFocusTrap';
import type { FeedbackItem, FeedbackStatus } from '../types';

const CATEGORY_LABELS = {
  bug: 'Something broke',
  idea: 'Idea',
  research_quality: 'Research quality',
  other: 'Other',
} as const;

const STATUSES: FeedbackStatus[] = ['new', 'reviewing', 'resolved'];

export default function FeedbackInboxModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [error, setError] = useState('');
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);

  useEffect(() => {
    api
      .listFeedback()
      .then((response) => setItems(response.items))
      .catch(() => setError('Feedback could not be loaded.'));
  }, []);

  const setStatus = async (id: string, status: FeedbackStatus) => {
    setItems((current) =>
      (current ?? []).map((item) =>
        item.id === id ? { ...item, status } : item
      )
    );
    await api.setFeedbackStatus(id, status).catch(() => undefined);
  };

  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-inbox-modal-title"
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-sheet shadow-2xl sm:max-w-3xl sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 bg-white/70 p-5 sm:p-6">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-brand">
              <Inbox size={13} />
              Admin
            </div>
            <h2
              id="feedback-inbox-modal-title"
              className="text-2xl font-semibold tracking-[-0.04em] text-slate-950"
            >
              User feedback
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close feedback inbox"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm hover:text-slate-700 sm:h-9 sm:w-9"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 p-5 sm:p-6">
          {!items && !error && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              Loading submissions…
            </div>
          )}
          {error && (
            <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}
          {items?.length === 0 && (
            <p className="py-16 text-center text-sm text-slate-500">
              No feedback yet.
            </p>
          )}
          {items?.map((item) => (
            <article
              key={item.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 td-card-shadow"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-brand-soft px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-brand">
                  {CATEGORY_LABELS[item.category]}
                </span>
                <span className="text-xs font-medium text-slate-600">
                  {item.author_name} · {item.author_email}
                </span>
                <span className="text-[10px] text-slate-400">
                  {new Date(item.created_at).toLocaleString()}
                </span>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                {item.message}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                <span className="text-[10px] uppercase tracking-wide text-slate-400">
                  {[item.workspace_name, item.page_path]
                    .filter(Boolean)
                    .join(' · ') || 'no page context'}
                </span>
                <div className="ml-auto flex gap-1">
                  {STATUSES.map((status) => (
                    <button
                      key={status}
                      onClick={() => void setStatus(item.id, status)}
                      className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide transition ${
                        item.status === status
                          ? 'bg-slate-950 text-white'
                          : 'bg-slate-100 text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
