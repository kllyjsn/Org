import type { BuyingRole } from '../types';

export const ROLE_META: Record<
  BuyingRole,
  { label: string; chip: string; dot: string }
> = {
  champion: {
    label: 'Champion',
    chip: 'bg-emerald-100 text-emerald-800',
    dot: 'bg-emerald-500',
  },
  economic_buyer: {
    label: 'Economic buyer',
    chip: 'bg-violet-100 text-violet-800',
    dot: 'bg-violet-500',
  },
  decision_maker: {
    label: 'Decision maker',
    chip: 'bg-blue-100 text-blue-800',
    dot: 'bg-blue-500',
  },
  technical_buyer: {
    label: 'Technical buyer',
    chip: 'bg-cyan-100 text-cyan-800',
    dot: 'bg-cyan-500',
  },
  influencer: {
    label: 'Influencer',
    chip: 'bg-amber-100 text-amber-800',
    dot: 'bg-amber-500',
  },
  blocker: {
    label: 'Blocker',
    chip: 'bg-rose-100 text-rose-800',
    dot: 'bg-rose-500',
  },
  none: { label: '', chip: '', dot: '' },
};

const DEPT_PALETTE = [
  'bg-indigo-700',
  'bg-sky-700',
  'bg-emerald-700',
  'bg-amber-700',
  'bg-rose-700',
  'bg-violet-700',
  'bg-cyan-700',
  'bg-fuchsia-700',
  'bg-lime-700',
  'bg-orange-700',
];

export function deptColor(department: string | null): string {
  if (!department) return 'bg-slate-600';
  let h = 0;
  for (const ch of department) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return DEPT_PALETTE[h % DEPT_PALETTE.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '');
}
