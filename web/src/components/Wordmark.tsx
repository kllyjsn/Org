const SIZES = {
  sm: { badge: 'h-5 w-5 rounded', icon: 12, text: 'text-lg' },
  md: { badge: 'h-6 w-6 rounded-md', icon: 14, text: 'text-xl' },
  lg: { badge: 'h-8 w-8 rounded-lg', icon: 18, text: 'text-2xl' },
} as const;

export function Wordmark({
  size = 'md',
  inverse = false,
}: {
  size?: keyof typeof SIZES;
  inverse?: boolean;
}) {
  const s = SIZES[size];
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        className={`${s.badge} relative flex items-center justify-center overflow-hidden bg-[#5b4cf0] shadow-[inset_0_0_0_1px_rgba(255,255,255,.16)]`}
      >
        <span className="absolute inset-x-0 bottom-0 h-[42%] bg-[#c9f04b]" />
        <svg
          width={s.icon}
          height={s.icon}
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M8.5 11V5.5m0 0L5.8 8.2M8.5 5.5l2.7 2.7"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-white"
          />
          <path
            d="M15.5 13v5.5m0 0l2.7-2.7m-2.7 2.7l-2.7-2.7"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-slate-950"
          />
        </svg>
      </span>
      <span
        className={`${s.text} font-extrabold tracking-[-0.045em] ${
          inverse ? 'text-white' : 'text-slate-950'
        }`}
      >
        TopDown
      </span>
    </span>
  );
}
