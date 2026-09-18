const SIZES = {
  sm: { mark: 22, text: 'text-lg' },
  md: { mark: 26, text: 'text-xl' },
  lg: { mark: 32, text: 'text-2xl' },
} as const;

export function Wordmark({
  size = 'md',
  inverse = false,
  markOnly = false,
}: {
  size?: keyof typeof SIZES;
  inverse?: boolean;
  /** Renders the arrow mark alone — used in narrow icon rails. */
  markOnly?: boolean;
}) {
  const s = SIZES[size];
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg
        width={s.mark}
        height={s.mark}
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M10 26V6m0 0L4.5 11.5M10 6l5.5 5.5"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={inverse ? 'text-white' : 'text-[#5b4cf0]'}
        />
        <path
          d="M22 6v20m0 0 5.5-5.5M22 26l-5.5-5.5"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={inverse ? 'text-[#c9f04b]' : 'text-slate-950'}
        />
      </svg>
      {!markOnly && (
        <span
          className={`${s.text} font-bold tracking-[-0.04em] ${
            inverse ? 'text-white' : 'text-slate-950'
          }`}
        >
          TopDown
        </span>
      )}
    </span>
  );
}
