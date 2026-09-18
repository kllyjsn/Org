import type { Transition, Variants } from 'framer-motion';

/** Shared motion scale — mirrored as CSS vars in index.css. */
export const DURATION = { fast: 0.12, base: 0.2, slow: 0.3 } as const;
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** React Flow viewport moves (fitView / setCenter / setViewport), in ms. 0 under reduced motion. */
export const CANVAS_MOVE_MS = 450;
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
export function canvasMoveMs(): number {
  return prefersReducedMotion() ? 0 : CANVAS_MOVE_MS;
}

export const overlayTransition: Transition = { duration: DURATION.base, ease: EASE_OUT };
export const overlayVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

/** Bottom sheet on phones / centered dialog on sm+. */
export const sheetVariants: Variants = {
  hidden: { opacity: 0, y: 24, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: DURATION.slow, ease: EASE_OUT } },
  exit: { opacity: 0, y: 16, scale: 0.99, transition: { duration: DURATION.fast, ease: EASE_OUT } },
};

/** Command palette drops from the top. */
export const paletteVariants: Variants = {
  hidden: { opacity: 0, y: -12, scale: 0.985 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: DURATION.base, ease: EASE_OUT } },
  exit: { opacity: 0, y: -8, scale: 0.99, transition: { duration: DURATION.fast, ease: EASE_OUT } },
};

/** Side/bottom person panel. */
export const panelTransition: Transition = { type: 'spring', stiffness: 320, damping: 32, mass: 0.9 };
