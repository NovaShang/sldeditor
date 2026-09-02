/**
 * Re-export the element library indexed by `LibraryEntry.id` for use in the
 * compile pipeline. The actual library is loaded once in
 * `src/element-library/index.ts`.
 */

import { libraryById } from '../element-library';
import type { LibraryEntry, SymbolStandard } from '../model';

export const LIBRARY: ReadonlyMap<string, LibraryEntry> = new Map(
  Object.entries(libraryById),
);

export function getLibraryEntry(kind: string): LibraryEntry | undefined {
  return libraryById[kind];
}

/** Prefix that marks a kind as defined by a document rather than shipped. */
export const CUSTOM_KIND_PREFIX = 'custom:';

export function isCustomKind(kind: string): boolean {
  return kind.startsWith(CUSTOM_KIND_PREFIX);
}

/**
 * The built-in library plus a document's own kinds.
 *
 * Returns `LIBRARY` itself when there is nothing to merge — the common case by
 * far, and returning the same object keeps `compile()` from allocating a
 * ninety-entry Map on every keystroke.
 *
 * A custom entry can never shadow a built-in: ids are namespaced, and anything
 * that arrives without the prefix is dropped rather than trusted. Shadowing
 * would let a document redefine `breaker` for everyone who opens it, which is
 * a different and much worse feature than defining a new symbol.
 */
export function mergeCustomKinds(
  custom: readonly LibraryEntry[] | undefined,
): ReadonlyMap<string, LibraryEntry> {
  if (!custom?.length) return LIBRARY;
  const merged = new Map(LIBRARY);
  for (const entry of custom) {
    if (!entry?.id || !isCustomKind(entry.id)) continue;
    merged.set(entry.id, entry);
  }
  return merged;
}

/**
 * Swap in each entry's drawing for `standard`.
 *
 * Resolution happens HERE, once, on the map `compile()` publishes — not in the
 * renderers. Every surface that draws a symbol (canvas, SVG/PNG export, DXF
 * export, content bbox, label anchoring) reads `ResolvedElement.libraryDef`,
 * so doing it at this single point is what keeps the four of them from
 * drifting; a per-renderer lookup is exactly how an export ends up disagreeing
 * with the canvas.
 *
 * Only the drawing changes. `terminals`, `params`, `state`, `category` and
 * `stretchable` come from the base entry untouched, so switching standards can
 * never move a pin, re-route a wire, or alter what the compiler sees.
 *
 * `iec` (and absent) returns the input map unchanged — same object, so the
 * common case allocates nothing on a keystroke.
 */
export function applySymbolStandard(
  library: ReadonlyMap<string, LibraryEntry>,
  standard: SymbolStandard | undefined,
): ReadonlyMap<string, LibraryEntry> {
  if (!standard || standard === 'iec') return library;
  let out: Map<string, LibraryEntry> | null = null;
  for (const [id, entry] of library) {
    const variant = entry.variants?.[standard];
    if (!variant) continue;
    out ??= new Map(library);
    out.set(id, {
      ...entry,
      viewBox: variant.viewBox,
      width: variant.width,
      height: variant.height,
      svg: variant.svg,
      // Pin digits sit ON the terminals, which a variant may not move, so the
      // base entry's stay valid unless the variant draws its own.
      terminalLabelsSvg: variant.terminalLabelsSvg ?? entry.terminalLabelsSvg,
      label: variant.label ?? entry.label,
    });
  }
  return out ?? library;
}
