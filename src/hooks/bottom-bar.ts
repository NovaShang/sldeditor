/**
 * Bottom-bar fit: the three pieces of chrome along the bottom edge — the
 * outline tab (left), the main toolbar (centre) and the view toolbar (right) —
 * share one row and must never overlap.
 *
 * Width breakpoints can't guarantee that: the main toolbar's width depends on
 * the language (German labels are half again as long as English), the drawing
 * type (circuit diagrams swap Layout for Number wires) and whatever tools a
 * release adds. So each piece reports its *measured* width, and the row picks
 * the least-collapsed mode in which all three fit:
 *
 *  - `full`    labels everywhere
 *  - `tight`   main-toolbar labels off, zoom-% pill hidden
 *  - `compact` outline tab icon-only too
 *  - `dense`   one unified bar (outline + view controls folded into it)
 *
 * Widths are cached per mode, so growing the window steps back up as soon as a
 * roomier mode is known to fit; a mode never measured yet is simply tried.
 * Below the `dense` width tier (phones) the row is always `dense`.
 *
 * Provider component lives in `./bottom-bar-provider.tsx` (Fast Refresh).
 */

import { createContext, useContext, useLayoutEffect, useRef, type RefObject } from 'react';

export type BarMode = 'full' | 'tight' | 'compact' | 'dense';
export type BarPart = 'left' | 'bar' | 'right';
export type BarWidths = Partial<Record<BarPart, number>>;

export const BAR_MODES: readonly BarMode[] = ['full', 'tight', 'compact', 'dense'];

const RANK: Record<BarMode, number> = { full: 0, tight: 1, compact: 2, dense: 3 };

export function barAtLeast(m: BarMode, min: BarMode): boolean {
  return RANK[m] >= RANK[min];
}

/** Space kept between the row's pieces and from the editor's edges, px. */
export const BAR_EDGE = 12;
export const BAR_GAP = 8;

/**
 * Whether the three measured pieces fit side by side in `width`. `centered`
 * also requires the main toolbar to sit in the exact middle — clear of the
 * wider side piece on both sides — rather than slid towards the roomier side.
 */
export function rowFits(w: BarWidths, width: number, centered = false): boolean {
  const left = w.left ?? 0;
  const right = w.right ?? 0;
  const bar = w.bar ?? 0;
  if (centered) return bar + 2 * (BAR_EDGE + Math.max(left, right) + BAR_GAP) <= width;
  return BAR_EDGE + left + BAR_GAP + bar + BAR_GAP + right + BAR_EDGE <= width;
}

/**
 * The row's mode, from `floor` down. A centred toolbar wins over labels: the
 * first mode whose toolbar fits dead centre is taken; only when none does is
 * the least-collapsed mode that fits slid to one side used, and `dense` (one
 * unified bar) after that. A mode with no complete measurement yet is
 * returned as-is so it gets rendered and measured; the next pass then decides
 * with real numbers.
 */
export function pickBarMode(
  cache: Partial<Record<BarMode, BarWidths>>,
  width: number,
  floor: BarMode,
): BarMode {
  const candidates = BAR_MODES.filter((m) => m !== 'dense' && RANK[m] >= RANK[floor]);
  for (const m of candidates) {
    const w = cache[m];
    if (!w || w.left == null || w.bar == null || w.right == null) return m;
    if (rowFits(w, width, true)) return m;
  }
  for (const m of candidates) {
    if (rowFits(cache[m]!, width)) return m;
  }
  return 'dense';
}

/**
 * Centre of the main toolbar, px from the editor's left edge: the middle of
 * the editor when that leaves room on both sides, otherwise slid towards the
 * roomier side so it clears the outline tab and the view toolbar.
 */
export function barCenter(w: BarWidths, width: number): number {
  const bar = w.bar ?? 0;
  const min = BAR_EDGE + (w.left ?? 0) + BAR_GAP + bar / 2;
  const max = width - BAR_EDGE - (w.right ?? 0) - BAR_GAP - bar / 2;
  if (min > max) return min;
  return Math.min(Math.max(width / 2, min), max);
}

export interface BottomBarState {
  mode: BarMode;
  /** Editor width, px (null until measured). */
  width: number | null;
  /** The pieces' widths as measured in the current mode. */
  widths: BarWidths;
  report: (part: BarPart, mode: BarMode, width: number) => void;
}

export const BottomBarContext = createContext<BottomBarState>({
  mode: 'full',
  width: null,
  widths: {},
  report: () => {},
});

export function useBottomBar(): BottomBarState {
  return useContext(BottomBarContext);
}

/**
 * Report the border-box width of `ref` as `part`, tagged with the mode it was
 * rendered in. Nothing is reported on unmount: a piece only disappears in
 * `dense` (folded into the unified bar), which never consults the cache, and
 * a zero filed under the mode it left would make that mode look roomy.
 */
export function useReportBarWidth(part: BarPart, ref: RefObject<HTMLElement | null>): void {
  const { mode, report } = useBottomBar();
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => report(part, modeRef.current, el.offsetWidth);
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [part, ref, report]);
  // A mode switch can change the width without resizing the element box the
  // observer watches (same width, different content); re-report every mode.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) report(part, mode, el.offsetWidth);
  }, [part, ref, report, mode]);
}
