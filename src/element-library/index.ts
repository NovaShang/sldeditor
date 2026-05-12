import type { LibraryEntry } from '../model/library';

const modules = import.meta.glob<{ default: LibraryEntry }>('./*.json', {
  eager: true,
});

/** All library entries, in filesystem order. */
export const libraryEntries: LibraryEntry[] = Object.values(modules).map(
  (m) => m.default,
);

/** O(1) lookup by `LibraryEntry.id`. */
export const libraryById: Record<string, LibraryEntry> = Object.fromEntries(
  libraryEntries.map((e) => [e.id, e]),
);

/**
 * Display order and Chinese labels for palette categories.
 * Categories not listed here fall through to the end with their raw id.
 */
export const CATEGORY_ORDER: readonly string[] = [
  'busbar',
  'switching',
  'protection',
  'motor-control',
  'transformer',
  'instrument-transformer',
  'measurement',
  'source',
  'load',
  'storage',
  'compensation',
  'grounding',
  'renewable',
];

export const CATEGORY_LABELS: Record<string, string> = {
  busbar: '母线 / 接线',
  switching: '开关',
  protection: '保护',
  'motor-control': '电机控制',
  transformer: '变压器',
  'instrument-transformer': '互感器',
  measurement: '测量仪表',
  source: '电源',
  load: '负荷',
  storage: '储能',
  compensation: '无功补偿',
  grounding: '中性点接地',
  renewable: '新能源 / 电力电子',
};

/** Entries grouped by category, preserving filesystem order within each group. */
export const libraryByCategory: Record<string, LibraryEntry[]> = (() => {
  const groups: Record<string, LibraryEntry[]> = {};
  for (const entry of libraryEntries) {
    (groups[entry.category] ??= []).push(entry);
  }
  return groups;
})();
