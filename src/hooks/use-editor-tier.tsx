/**
 * Editor tier provider — wraps the editor's chrome with a context value
 * derived from a width supplied by the parent. The parent is the only one
 * that holds the DOM ref, so we keep the ResizeObserver there and just
 * push the resolved tier down through context.
 *
 * Pure helpers / hook live in `./editor-tier`.
 */

import type { ReactNode } from 'react';
import { TierContext, tierForWidth } from './editor-tier';

export function EditorTierProvider({
  width,
  children,
}: {
  width: number | null;
  children: ReactNode;
}) {
  const tier = width == null ? 'full' : tierForWidth(width);
  return <TierContext.Provider value={tier}>{children}</TierContext.Provider>;
}
