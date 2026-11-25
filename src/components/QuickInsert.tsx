/**
 * Cursor quick-insert palette. "/" over the canvas (or "Insert symbol…" in
 * the right-click menu) opens a search box right where the pointer is; type a
 * few words, pick with ↑/↓ and Enter, and the symbol lands at that spot — the
 * same placement a click with the place tool makes (snapping, the multi-pole
 * magnet, a bus tap), or wired to the pin the pointer was on.
 *
 * Search is the palette's (`searchEntries`: every word in any order, synonyms
 * through the library keywords, the drawing type's symbols only), so the two
 * can never disagree about what "coil" finds.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useLocale, useT } from '../i18n';
import { useLibT } from '../i18n/library';
import { searchEntries } from '../lib/library-search';
import type { LibraryEntry } from '../model/library';
import { useEditorStore } from '../store';
import {
  closeQuickInsert,
  quickInsertEntries,
  quickInsertPlace,
  recentQuickInserts,
  trackPointer,
  useQuickInsert,
  type QuickInsertAt,
} from './quick-insert-state';

const MAX_RESULTS = 8;
const WIDTH = 260;
const PAD = 8;

export function QuickInsert() {
  useEffect(() => trackPointer(), []);
  const at = useQuickInsert((s) => s.at);
  if (!at) return null;
  // Keyed by the spot, so reopening elsewhere starts a fresh search.
  return <QuickInsertBox key={`${at.screen[0]},${at.screen[1]}`} at={at} />;
}

function QuickInsertBox({ at }: { at: QuickInsertAt }) {
  const t = useT();
  const libT = useLibT();
  const locale = useLocale((s) => s.locale);
  const library = useEditorStore((s) => s.internal.library);
  const diagramType = useEditorStore((s) => s.internal.diagramType);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const entries = useMemo(() => quickInsertEntries(library, diagramType), [library, diagramType]);
  const results = useMemo(() => {
    if (query.trim() === '') {
      return recentQuickInserts().map((k) => entries.find((e) => e.id === k)).filter((e): e is LibraryEntry => !!e);
    }
    return searchEntries(entries, query, locale)
      .slice(0, MAX_RESULTS)
      .map((r) => r.entry);
  }, [entries, query, locale]);
  const current = Math.min(active, Math.max(0, results.length - 1));

  useEffect(() => {
    inputRef.current?.focus();
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) closeQuickInsert();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  const pick = (entry: LibraryEntry | undefined) => {
    if (!entry) return;
    closeQuickInsert();
    quickInsertPlace(entry.id, at);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeQuickInsert();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length) setActive((current + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length) setActive((current - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(results[current]);
    }
  };

  // Open just below-right of the cursor, kept on screen.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const left = Math.max(PAD, Math.min(at.screen[0] + 12, vw - WIDTH - PAD));
  const top = Math.max(PAD, Math.min(at.screen[1] + 12, vh - 340));

  return (
    <div
      ref={boxRef}
      role="dialog"
      aria-label={t('quickInsert.aria')}
      className="ole-glass ole-quick-insert fixed z-50 flex flex-col rounded-lg border border-border p-1 shadow-lg"
      style={{ left, top, width: WIDTH }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="relative">
        <Search className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={t('quickInsert.placeholder')}
          aria-label={t('quickInsert.aria')}
          aria-controls="ole-quick-insert-list"
          aria-activedescendant={results[current] ? `ole-qi-${results[current].id}` : undefined}
          className="h-8 w-full rounded-md border border-border/60 bg-background/50 ps-7 pe-2 text-xs placeholder:text-muted-foreground focus:border-border focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      {results.length > 0 ? (
        <ul id="ole-quick-insert-list" role="listbox" className="mt-1 max-h-72 overflow-y-auto">
          {results.map((entry, i) => (
            <li
              key={entry.id}
              id={`ole-qi-${entry.id}`}
              role="option"
              aria-selected={i === current}
              data-kind={entry.id}
              className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1 ${
                i === current ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
              }`}
              onPointerEnter={() => setActive(i)}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => pick(entry)}
            >
              <div className="flex h-6 w-10 shrink-0 items-center justify-center">
                <svg
                  viewBox={entry.viewBox}
                  className="ole-symbol size-full"
                  preserveAspectRatio="xMidYMid meet"
                  dangerouslySetInnerHTML={{ __html: entry.svg }}
                />
              </div>
              <span className="truncate text-xs">{libT(`${entry.id}.name`, entry.name)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-2 py-2 text-[11px] text-muted-foreground">
          {query.trim() ? t('quickInsert.empty') : t('quickInsert.typeToSearch')}
        </p>
      )}
      <p className="border-t border-border/50 px-2 pb-0.5 pt-1 text-[10px] text-muted-foreground">
        {t('quickInsert.keys')}
      </p>
    </div>
  );
}
