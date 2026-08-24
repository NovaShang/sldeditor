/**
 * Re-export the element library indexed by `LibraryEntry.id` for use in the
 * compile pipeline. The actual library is loaded once in
 * `src/element-library/index.ts`.
 */

import { libraryById } from '../element-library';
import type { LibraryEntry } from '../model';

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
