/**
 * Bottom-bar fit: the three pieces of chrome along the bottom edge — the
 * outline tab (left), the main toolbar (centre) and the view toolbar (right) —
 * share one row and must never overlap.
 *
 * "left" and "right" here are the INLINE start and end: under `dir=rtl` the
 * row mirrors (outline tab on the right) and every offset below is measured
 * from the start edge, which the pieces honour by anchoring with
 * `inset-inline-start` / `-end`. The arithmetic is the same either way.
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
 * Centre of the main toolbar, px from the editor's start (LTR: left) edge: the middle of
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
 *
 * The element is also marked `data-ole-bottom-chrome`, which is how Fit view
 * finds the bottom row and keeps the drawing clear of it.
 */
export function useReportBarWidth(part: BarPart, ref: RefObject<HTMLElement | null>): void {
  const { mode, report } = useBottomBar();
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.setAttribute('data-ole-bottom-chrome', part);
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

/**
 * The unified (`dense`) bar is one row of fixed-size buttons, so whether it
 * fits is arithmetic rather than measurement. It never scrolls: a strip that
 * scrolls sideways on a phone hides tools behind an edge nobody thinks to
 * swipe. Instead, as the editor narrows, it gives things up in this order —
 *
 *  1. the outline toggle moves into the More menu,
 *  2. so does the Junction tool (on a phone a wire dragged into empty space
 *     drops a junction anyway, so it is the least-needed tool on the bar),
 *  3. the buttons narrow down to `DENSE_LABEL_MIN`, labels still underneath,
 *  4. the labels go (icon-only buttons, still a full-height touch target).
 *
 * Everything folded stays one tap away in More, so every tool is reachable at
 * every width.
 */
export const DENSE_BUTTON = 48;
/** Narrowest button that still carries its label underneath. */
export const DENSE_LABEL_MIN = 44;
/** Narrowest icon-only button. */
export const DENSE_ICON_MIN = 32;
/** The bar's own padding + border (`p-1`, 1px border), both sides, px. */
export const DENSE_PAD = 10;
export const DENSE_GAP = 2;
/** How many items the dense bar can fold into its More menu. */
export const DENSE_MAX_FOLD = 2;

export interface DenseFit {
  /** Items folded into More: 1 = the outline toggle, 2 = + the Junction tool. */
  fold: number;
  /** Button width, px. */
  button: number;
  /** Labels shown under the icons. */
  labels: boolean;
}

/** Width of a dense bar of `n` buttons, each `button` px wide. */
export function denseBarWidth(n: number, button: number): number {
  return n * button + Math.max(0, n - 1) * DENSE_GAP + DENSE_PAD;
}

/**
 * How the dense bar fits an editor `width` px wide, given `items` buttons on
 * it when nothing is folded.
 */
export function denseBarFit(items: number, width: number | null): DenseFit {
  if (width == null) return { fold: 0, button: DENSE_BUTTON, labels: true };
  const avail = width - 2 * BAR_EDGE;
  const widest = (n: number) =>
    Math.floor((avail - DENSE_PAD - Math.max(0, n - 1) * DENSE_GAP) / n);
  for (let fold = 0; fold <= DENSE_MAX_FOLD; fold++) {
    if (widest(items - fold) >= DENSE_BUTTON) {
      return { fold, button: DENSE_BUTTON, labels: true };
    }
  }
  const b = widest(items - DENSE_MAX_FOLD);
  if (b >= DENSE_LABEL_MIN) return { fold: DENSE_MAX_FOLD, button: b, labels: true };
  return { fold: DENSE_MAX_FOLD, button: Math.max(DENSE_ICON_MIN, b), labels: false };
}

/** The dense bar's button geometry, read by every button on it. */
export const DenseSlotContext = createContext<{ button: number; labels: boolean }>({
  button: DENSE_BUTTON,
  labels: true,
});
