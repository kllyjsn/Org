export type PngPlan =
  | {
      mode: 'full';
      width: number;
      height: number;
      zoom: number;
    }
  | {
      mode: 'viewport';
      reason: string;
    };

export const PNG_MAX_SIDE = 8192;
export const PNG_MAX_AREA = 16_000_000;
export const PNG_MIN_ZOOM = 0.22;

export function planPngExport(
  bounds: { width: number; height: number },
  opts: {
    maxSide?: number;
    maxArea?: number;
    minZoom?: number;
    padding?: number;
  } = {}
): PngPlan {
  if (bounds.width <= 0 || bounds.height <= 0) {
    return { mode: 'full', width: 1080, height: 720, zoom: 1 };
  }
  const maxSide = opts.maxSide ?? PNG_MAX_SIDE;
  const maxArea = opts.maxArea ?? PNG_MAX_AREA;
  const minZoom = opts.minZoom ?? PNG_MIN_ZOOM;
  const padding = opts.padding ?? 0.08;
  const targetWidth = bounds.width * (1 + 2 * padding);
  const targetHeight = bounds.height * (1 + 2 * padding);
  const zoom = Math.min(
    1,
    maxSide / targetWidth,
    maxSide / targetHeight,
    Math.sqrt(maxArea / (targetWidth * targetHeight))
  );
  if (zoom < minZoom) {
    return {
      mode: 'viewport',
      reason: 'Map too large for a single image — exported the visible area',
    };
  }
  return {
    mode: 'full',
    width: Math.ceil(targetWidth * zoom),
    height: Math.ceil(targetHeight * zoom),
    zoom,
  };
}
