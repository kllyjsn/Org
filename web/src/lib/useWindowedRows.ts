import { useEffect, useRef, useState, type RefObject } from 'react';

export interface WindowRange {
  start: number;
  end: number;
  topPad: number;
  bottomPad: number;
}

export function windowRange(
  scrollTop: number,
  height: number,
  count: number,
  rowHeight: number,
  overscan: number
): WindowRange {
  const safeCount = Math.max(0, count);
  const safeRowHeight = Math.max(1, rowHeight);
  const safeOverscan = Math.max(0, overscan);
  const start = Math.max(0, Math.floor(Math.max(0, scrollTop) / safeRowHeight) - safeOverscan);
  const end = Math.min(
    safeCount,
    Math.ceil((Math.max(0, scrollTop) + Math.max(0, height)) / safeRowHeight) + safeOverscan
  );
  return {
    start,
    end: Math.max(start, end),
    topPad: start * safeRowHeight,
    bottomPad: Math.max(0, (safeCount - end) * safeRowHeight),
  };
}

export function useWindowedRows(opts: {
  count: number;
  rowHeight: number;
  overscan?: number;
  scrollRef: RefObject<HTMLElement>;
}): WindowRange {
  const overscan = opts.overscan ?? 8;
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 });
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const container = opts.scrollRef.current;
    if (!container) return;
    const update = () => {
      frame.current = null;
      setViewport({
        scrollTop: container.scrollTop,
        height: container.clientHeight,
      });
    };
    const schedule = () => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(update);
    };
    update();
    container.addEventListener('scroll', schedule, { passive: true });
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(schedule);
    observer?.observe(container);
    return () => {
      container.removeEventListener('scroll', schedule);
      observer?.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [opts.scrollRef]);

  if (opts.scrollRef.current === null && viewport.height === 0) {
    return {
      start: 0,
      end: Math.min(opts.count, 30),
      topPad: 0,
      bottomPad: Math.max(0, opts.count - Math.min(opts.count, 30)) * opts.rowHeight,
    };
  }
  return windowRange(viewport.scrollTop, viewport.height, opts.count, opts.rowHeight, overscan);
}
