/**
 * Bottom-bar provider — picks the row's mode from the measured widths of its
 * three pieces. Pure helpers and hooks live in `./bottom-bar`.
 */

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { atLeast, type Tier } from './editor-tier';
import {
  BottomBarContext,
  pickBarMode,
  type BarMode,
  type BarPart,
  type BarWidths,
  type BottomBarState,
} from './bottom-bar';

export function BottomBarProvider({
  width,
  tier,
  children,
}: {
  width: number | null;
  tier: Tier;
  children: ReactNode;
}) {
  const cache = useRef<Partial<Record<BarMode, BarWidths>>>({});
  // Bumped whenever a measurement changes, so the mode is re-picked.
  const [version, setVersion] = useState(0);

  const report = useCallback((part: BarPart, mode: BarMode, w: number) => {
    const entry = (cache.current[mode] ??= {});
    if (entry[part] != null && Math.abs(entry[part]! - w) < 1) return;
    entry[part] = w;
    setVersion((v) => v + 1);
  }, []);

  const floor: BarMode = atLeast(tier, 'dense') ? 'dense' : 'full';
  const mode = width == null ? floor : pickBarMode(cache.current, width, floor);

  const value = useMemo<BottomBarState>(
    () => ({ mode, width, widths: { ...(cache.current[mode] ?? {}) }, report }),
    // `version` stands for the cache contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, width, report, version],
  );
  return <BottomBarContext.Provider value={value}>{children}</BottomBarContext.Provider>;
}
