/**
 * Eager-load every element library JSON at build time and expose a Map keyed
 * by `LibraryEntry.id` (which equals `Element.kind` in DiagramFile).
 */

import type { LibraryEntry } from '@/model';

const modules = import.meta.glob<{ default: LibraryEntry }>(
  '../element-library/*.json',
  { eager: true },
);

const entries = new Map<string, LibraryEntry>();
for (const mod of Object.values(modules)) {
  const entry = mod.default;
  entries.set(entry.id, entry);
}

export const LIBRARY: ReadonlyMap<string, LibraryEntry> = entries;

export function getLibraryEntry(kind: string): LibraryEntry | undefined {
  return entries.get(kind);
}
