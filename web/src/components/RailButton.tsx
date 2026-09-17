import type { ReactNode } from 'react';

/**
 * Icon button for the left navigation rail. Icons only — the label shows as
 * a native tooltip on hover, matching compact sidebar conventions.
 */
export default function RailButton({
  icon,
  label,
  onClick,
  active = false,
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
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition sm:h-10 sm:w-10 ${
        active
          ? 'bg-white/15 text-white'
          : accent
            ? 'bg-[#5b4cf0] text-white hover:bg-[#6b5cf8]'
            : 'text-slate-400 hover:bg-white/10 hover:text-white'
      } ${disabled ? 'cursor-not-allowed opacity-35' : ''}`}
    >
      {icon}
    </button>
  );
}

export function RailSeparator() {
  return <div className="my-1.5 h-px w-7 bg-white/10" />;
}
