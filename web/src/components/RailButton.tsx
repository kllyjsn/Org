import type { ReactNode } from 'react';

/**
 * Nav row for the left sidebar. Icon-only on phones; icon + text label on
 * sm screens and up, where the rail widens into a labeled sidebar.
 */
export default function RailButton({
  icon,
  label,
  onClick,
  active,
  accent = false,
  disabled = false,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  accent?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      className={`flex h-11 w-11 shrink-0 items-center justify-center gap-2.5 rounded-xl transition active:scale-[.96] sm:h-9 sm:w-full sm:justify-start sm:px-3 ${
        active
          ? 'bg-white/15 text-white'
          : accent
            ? 'bg-brand text-white hover:bg-brand-hover'
            : 'text-slate-400 hover:bg-white/10 hover:text-white'
      } ${disabled ? 'cursor-not-allowed opacity-35' : ''}`}
    >
      <span className="shrink-0" aria-hidden="true">{icon}</span>
      <span className="hidden truncate text-[13px] font-medium sm:block">
        {label}
      </span>
    </button>
  );
}

export function RailSeparator() {
  return (
    <div className="my-1.5 h-px w-7 self-center bg-white/10 sm:w-auto sm:self-stretch" />
  );
}
