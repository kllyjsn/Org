const SIZES = {
  sm: { badge: 'h-5 w-5 rounded', icon: 12, text: 'text-lg' },
  md: { badge: 'h-6 w-6 rounded-md', icon: 14, text: 'text-xl' },
  lg: { badge: 'h-8 w-8 rounded-lg', icon: 18, text: 'text-2xl' },
} as const;

export function Wordmark({ size = 'md' }: { size?: keyof typeof SIZES }) {
  const s = SIZES[size];
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`${s.badge} flex items-center justify-center bg-indigo-600`}
      >
        <svg
          width={s.icon}
          height={s.icon}
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M9 18V6m0 0L5.5 9.5M9 6l3.5 3.5"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-white"
          />
          <path
            d="M15 6v12m0 0l3.5-3.5M15 18l-3.5-3.5"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-white"
          />
        </svg>
      </span>
      <span className={`${s.text} font-bold tracking-tight text-slate-900`}>
        Top<span className="text-indigo-600">Down</span>
      </span>
    </span>
  );
}
