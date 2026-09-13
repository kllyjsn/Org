import { useState } from 'react';
import { Building2, Loader2, Sparkles, X } from 'lucide-react';
import { api, ApiError } from '../api';
import type { SellerProfile } from '../types';

function list(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim().replace(/^[-•]\s*/, ''))
    .filter(Boolean);
}

function ListField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <textarea
        className="min-h-24 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm leading-5 outline-none transition focus:border-[#796df5] focus:bg-white"
        value={value.join('\n')}
        onChange={(event) => onChange(list(event.target.value))}
      />
    </label>
  );
}

export default function SellerProfileModal({
  workspaceId,
  initialProfile,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  initialProfile: SellerProfile | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [domain, setDomain] = useState(initialProfile?.domain ?? '');
  const [profile, setProfile] = useState<SellerProfile | null>(initialProfile);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const research = async () => {
    if (!domain.trim()) return;
    setLoading(true);
    setError('');
    try {
      const result = await api.researchSellerProfile(workspaceId, domain.trim());
      setProfile(result.profile);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not research this company.'
      );
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!profile) return;
    setLoading(true);
    setError('');
    try {
      await api.saveSellerProfile(workspaceId, profile);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save profile.');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-sm">
      <div className="max-h-[94vh] w-full max-w-4xl overflow-auto rounded-3xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-100 bg-white/95 px-5 py-5 backdrop-blur sm:px-7">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-[#5b4cf0]">
              <Sparkles size={14} /> Your selling context
            </div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
              Teach TopDown what you sell
            </h2>
            <p className="mt-1 max-w-xl text-sm text-slate-500">
              Paste your company URL. We’ll fill this in, then you can edit it
              whenever your story changes.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 sm:p-7">
          {!profile ? (
            <div className="mx-auto max-w-xl py-8 sm:py-16">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#eeecff] text-[#5b4cf0]">
                <Building2 size={25} />
              </div>
              <label className="block text-sm font-semibold text-slate-800">
                What company do you sell for?
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    autoFocus
                    className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-[#796df5]"
                    placeholder="stripe.com"
                    value={domain}
                    onChange={(event) => setDomain(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void research();
                    }}
                  />
                  <button
                    onClick={() => void research()}
                    disabled={loading || !domain.trim()}
                    className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {loading ? (
                      <span className="flex items-center gap-2">
                        <Loader2 size={16} className="animate-spin" /> Researching
                      </span>
                    ) : (
                      'Build my profile'
                    )}
                  </button>
                </div>
              </label>
              <p className="mt-3 text-xs leading-5 text-slate-400">
                We use current public company information. Nothing is final
                until you review it.
              </p>
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="space-y-5">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Company
                  </span>
                  <input
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#796df5]"
                    value={profile.companyName}
                    onChange={(event) =>
                      setProfile({ ...profile, companyName: event.target.value })
                    }
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    What you do
                  </span>
                  <textarea
                    className="min-h-28 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm leading-5 outline-none focus:border-[#796df5]"
                    value={profile.summary}
                    onChange={(event) =>
                      setProfile({ ...profile, summary: event.target.value })
                    }
                  />
                </label>
                <ListField
                  label="Products"
                  value={profile.products}
                  onChange={(products) => setProfile({ ...profile, products })}
                />
                <ListField
                  label="Target customers"
                  value={profile.targetCustomers}
                  onChange={(targetCustomers) =>
                    setProfile({ ...profile, targetCustomers })
                  }
                />
                <ListField
                  label="Use cases"
                  value={profile.useCases}
                  onChange={(useCases) => setProfile({ ...profile, useCases })}
                />
              </div>
              <div className="space-y-5">
                <ListField
                  label="Proof points"
                  value={profile.proofPoints}
                  onChange={(proofPoints) =>
                    setProfile({ ...profile, proofPoints })
                  }
                />
                <ListField
                  label="Competitors"
                  value={profile.competitors}
                  onChange={(competitors) =>
                    setProfile({ ...profile, competitors })
                  }
                />
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Positioning
                  </span>
                  <textarea
                    className="min-h-36 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm leading-5 outline-none focus:border-[#796df5]"
                    value={profile.positioning}
                    onChange={(event) =>
                      setProfile({ ...profile, positioning: event.target.value })
                    }
                  />
                </label>
                <div className="rounded-2xl bg-[#f6f7f2] p-4 text-xs leading-5 text-slate-500">
                  This context personalizes initiative angles, account
                  briefings, and recommendations. You remain the editor.
                </div>
              </div>
            </div>
          )}
          {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}
        </div>

        {profile && (
          <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-slate-100 bg-white/95 px-5 py-4 backdrop-blur sm:flex-row sm:justify-between sm:px-7">
            <button
              onClick={() => {
                setProfile(null);
                setDomain(profile.domain);
              }}
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-100"
            >
              Research another company
            </button>
            <button
              onClick={() => void save()}
              disabled={loading || !profile.companyName.trim()}
              className="rounded-xl bg-[#5b4cf0] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#4d3fe0] disabled:opacity-50"
            >
              {loading ? 'Saving…' : 'Use this selling context'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
