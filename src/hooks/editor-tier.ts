/**
 * Editor responsiveness tier: types, breakpoints, helpers, hook.
 *
 * Provider component lives in the sibling `.tsx` file so React Fast Refresh
 * stays clean (a single .tsx file mixing components and constants warns).
 *
 * Tiers are monotonic — each higher tier subsumes the lower ones. Component
 * code should use `atLeast(t, 'compact')` instead of `t === 'compact'`.
 */

import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type RefObject,
} from 'react';

export type Tier = 'full' | 'tight' | 'compact' | 'dense' | 'mini';

/**
 * Width thresholds. The key is the *next-tier-down* boundary: at or above
 * `tight` (900) the layout is `full`; below 900 it's `tight`, etc. Names line
 * up with what each tier collapses:
 *  - `tight`:   FloatingToolbar tool labels off and ViewToolbar's zoom-% pill
 *               hides. The centered main toolbar (≈ 510px wide with labels)
 *               otherwise collides with the right-anchored ViewToolbar
 *               anywhere below ~880px.
 *  - `compact`: outline tab also goes icon-only.
 *  - `dense`:   ToolHint pill hidden; ViewToolbar collapses to one popover.
 *  - `mini`:    FloatingToolbar's [Undo/Redo/Layout] group collapses too.
 */
export const BREAKPOINTS = {
  tight: 1024,
  compact: 720,
  dense: 520,
  mini: 380,
} as const;

const RANK: Record<Tier, number> = {
  full: 0,
  tight: 1,
  compact: 2,
  dense: 3,
  mini: 4,
};

export function atLeast(t: Tier, min: Tier): boolean {
  return RANK[t] >= RANK[min];
}

export function tierForWidth(w: number): Tier {
  if (w >= BREAKPOINTS.tight) return 'full';
  if (w >= BREAKPOINTS.compact) return 'tight';
  if (w >= BREAKPOINTS.dense) return 'compact';
  if (w >= BREAKPOINTS.mini) return 'dense';
  return 'mini';
}

export const TierContext = createContext<Tier>('full');

export function useEditorTier(): Tier {
  return useContext(TierContext);
}

/**
 * Track the `clientWidth` of an element via ResizeObserver. Lives where the
 * ref does (e.g., directly in `EditorShell`) — the layout effect needs the
 * ref to be already attached, which it is in the same component but isn't
 * yet when a child reads it. Returns `null` until the first measurement.
 */
export function useObservedWidth(
  ref: RefObject<HTMLElement | null>,
): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      const w = el.clientWidth;
      setWidth((prev) => (prev === w ? prev : w));
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}
