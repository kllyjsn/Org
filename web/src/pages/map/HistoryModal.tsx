import { useRef } from 'react';
import { useFocusTrap } from '../../lib/useFocusTrap';
import type { MapVersion } from '../../types';

export default function HistoryModal(props: {
  versions: MapVersion[];
  restoreVersion: (versionId: string) => Promise<void>;
  onClose: () => void;
}) {
  const { versions, restoreVersion, onClose } = props;
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4">
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-modal-title"
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 id="history-modal-title" className="font-semibold text-slate-900">
              Version history
            </h2>
            <p className="text-xs text-slate-500">
              Restore an earlier collaborative save.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100"
          >
            Close
          </button>
        </div>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {versions.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-400">
              No earlier versions yet.
            </p>
          )}
          {versions.map((version) => (
            <div
              key={version.id}
              className="flex items-center justify-between rounded-xl border border-slate-200 p-3"
            >
              <div>
                <p className="text-sm font-medium text-slate-700">
                  {version.author_name}
                </p>
                <p className="text-xs text-slate-400">
                  {new Date(version.created_at).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => void restoreVersion(version.id)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Restore
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
