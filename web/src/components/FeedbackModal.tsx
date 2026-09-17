import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, MessageSquare, X } from 'lucide-react';
import { api, ApiError } from '../api';
import type { FeedbackCategory } from '../types';
import { useFocusTrap } from '../lib/useFocusTrap';

const CATEGORIES: { id: FeedbackCategory; label: string; detail: string }[] = [
  { id: 'bug', label: 'Something broke', detail: 'It failed or looked wrong' },
  { id: 'idea', label: 'Idea', detail: 'Something you wish it did' },
  {
    id: 'research_quality',
    label: 'Research quality',
    detail: 'Wrong person, title, or source',
  },
  { id: 'other', label: 'Other', detail: 'Anything else' },
];

export default function FeedbackModal({
  workspaceId,
  onClose,
}: {
  workspaceId?: string | null;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<FeedbackCategory>('idea');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    if (message.trim().length < 3 || sending) return;
    setSending(true);
    setError('');
    try {
      await api.sendFeedback({
        category,
        message: message.trim(),
        pagePath: window.location.pathname,
        workspaceId: workspaceId ?? null,
      });
      setSent(true);
      window.setTimeout(onClose, 1_200);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Feedback could not be sent.'
      );
    } finally {
      setSending(false);
    }
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
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 26, stiffness: 260 }}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-[#f9faf7] p-5 shadow-2xl sm:rounded-3xl sm:p-7"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-[#5b4cf0]">
              <MessageSquare size={13} />
              Tell us what to fix
            </div>
            <h2 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-3xl">
              Send feedback.
            </h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
              This goes straight to the team with the page you were on. No
              account content is attached.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close feedback"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm hover:text-slate-700"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {CATEGORIES.map((item) => (
            <button
              key={item.id}
              onClick={() => setCategory(item.id)}
              className={`rounded-2xl border p-3 text-left transition ${
                category === item.id
                  ? 'border-[#5b4cf0] bg-white shadow-sm'
                  : 'border-slate-200 bg-white/60 hover:border-slate-300'
              }`}
            >
              <span className="block text-sm font-semibold text-slate-950">
                {item.label}
              </span>
              <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">
                {item.detail}
              </span>
            </button>
          ))}
        </div>

        <textarea
          autoFocus
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="What happened, or what would make this better?"
          className="mt-4 min-h-32 w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-sm leading-6 outline-none transition focus:border-[#5b4cf0] focus:ring-4 focus:ring-[#5b4cf0]/10"
        />

        {error && (
          <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}

        <button
          onClick={() => void send()}
          disabled={message.trim().length < 3 || sending || sent}
          className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          {sending && <Loader2 size={15} className="animate-spin" />}
          {sent ? 'Thanks — sent.' : 'Send to the team'}
        </button>
      </motion.div>
    </div>
  );
}
