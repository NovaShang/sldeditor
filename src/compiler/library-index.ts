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
