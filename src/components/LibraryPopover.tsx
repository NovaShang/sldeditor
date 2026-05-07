/**
 * Element library popover. Visible whenever the place tool is active —
 * the FloatingToolbar's "元件" button toggles that tool, and picking an
 * entry here arms `placeKind`. Closing (X) returns to the select tool so
 * the place state and the popover stay in lockstep.
 */

import { useCallback, useMemo, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  libraryByCategory,
} from '@/element-library';
import { usePanels } from '@/hooks/use-panels';
import { useEditorStore } from '@/store';
import type { LibraryEntry } from '@/model/library';

const PALETTE_COLLAPSE_STORAGE_KEY = 'ole-palette-collapsed';

/**
 * Library entry IDs that should NOT appear in the palette. The bus is drawn
 * via the dedicated busbar tool (click + drag); having it in the element
 * grid would confuse users into trying to drop it like a fixed-size symbol.
 */
const PALETTE_HIDDEN_IDS = new Set<string>(['busbar']);

const PALETTE_BY_CATEGORY: Record<string, LibraryEntry[]> = (() => {
  const out: Record<string, LibraryEntry[]> = {};
  for (const [cat, entries] of Object.entries(libraryByCategory)) {
    const visible = entries.filter((e) => !PALETTE_HIDDEN_IDS.has(e.id));
    if (visible.length) out[cat] = visible;
  }
  return out;
})();

const CATEGORY_IDS: readonly string[] = (() => {
  const known = new Set(CATEGORY_ORDER);
  const extras = Object.keys(PALETTE_BY_CATEGORY).filter((c) => !known.has(c));
  return [
    ...CATEGORY_ORDER.filter((c) => PALETTE_BY_CATEGORY[c]?.length),
    ...extras,
  ];
})();

function readPaletteCollapsed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(PALETTE_COLLAPSE_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr)
      ? new Set(arr.filter((x) => typeof x === 'string'))
      : new Set();
  } catch {
    return new Set();
  }
}

function writePaletteCollapsed(s: Set<string>) {
  try {
    window.localStorage.setItem(
      PALETTE_COLLAPSE_STORAGE_KEY,
      JSON.stringify([...s]),
    );
  } catch {
    // ignore
  }
}

export function LibraryPopover() {
  const open = useEditorStore((s) => s.activeTool === 'place');
  const setTool = useEditorStore((s) => s.setActiveTool);
  const outlineOpen = usePanels((s) => s.outlineOpen);
  // Insets so the popover never reaches the floating chrome:
  //  - top: leave room for the TopBar     (12px gutter + 48px toolbar + 8px margin)
  //  - bottom: leave room for the bottom-toolbars / outline button
  //  - when outline is expanded, leave room for the outline panel (max ~50vh)
  const TOP_INSET = 68;
  // Outline panel max-height (when library open) is `min(40vh, ...)`, anchored
  // at bottom-3, so reserved bottom space = 40vh + 12px (anchor) + 8px (gap).
  const BOTTOM_INSET = outlineOpen
    ? 'calc(40vh + 20px)'
    : '68px';
  const maxHeight = `calc(100vh - ${TOP_INSET}px - ${BOTTOM_INSET})`;
  if (!open) return null;
  return (
    <div
      className="absolute left-3 z-20"
      style={{ top: TOP_INSET }}
      role="dialog"
      aria-label="元件库"
    >
      <aside
        className="ole-glass flex w-72 flex-col overflow-hidden rounded-2xl border border-border shadow-md"
        style={{ maxHeight }}
      >
        <div className="flex items-center gap-1.5 border-b border-border/40 px-3 py-2">
          <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            元件库
          </span>
          <button
            type="button"
            onClick={() => setTool('select')}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            aria-label="关闭"
            title="关闭"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <LibraryBody />
      </aside>
    </div>
  );
}

function LibraryBody() {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    readPaletteCollapsed(),
  );

  const filteredByCat = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PALETTE_BY_CATEGORY;
    const out: Record<string, LibraryEntry[]> = {};
    for (const [cat, entries] of Object.entries(PALETTE_BY_CATEGORY)) {
      const hits = entries.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.id.toLowerCase().includes(q) ||
          (e.description?.toLowerCase().includes(q) ?? false),
      );
      if (hits.length) out[cat] = hits;
    }
    return out;
  }, [query]);

  const isSearching = query.trim().length > 0;
  const noMatch =
    isSearching && Object.values(filteredByCat).every((e) => !e?.length);

  const handleToggle = useCallback((catId: string, isOpen: boolean) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (isOpen) next.delete(catId);
      else next.add(catId);
      writePaletteCollapsed(next);
      return next;
    });
  }, []);

  return (
    <>
      <div className="px-2 pb-1.5 pt-2">
        <SearchBox value={query} onChange={setQuery} />
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {noMatch ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            没有匹配的元件
          </p>
        ) : (
          CATEGORY_IDS.map((catId) => {
            const entries = filteredByCat[catId];
            if (!entries?.length) return null;
            const total = PALETTE_BY_CATEGORY[catId]?.length ?? entries.length;
            const label = CATEGORY_LABELS[catId] ?? catId;
            const isOpen = isSearching || !collapsed.has(catId);
            return (
              <details
                key={catId}
                open={isOpen}
                className="group mb-2 last:mb-0"
                onToggle={(e) => {
                  if (isSearching) return;
                  handleToggle(
                    catId,
                    (e.currentTarget as HTMLDetailsElement).open,
                  );
                }}
              >
                <summary className="flex cursor-pointer select-none items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-accent hover:text-accent-foreground">
                  <ChevronDown className="size-3 transition-transform [details:not([open])>summary>&]:-rotate-90" />
                  <span className="flex-1">{label}</span>
                  <CountChip>
                    {isSearching && entries.length !== total
                      ? `${entries.length}/${total}`
                      : total}
                  </CountChip>
                </summary>
                <ul className="mt-0.5 space-y-px">
                  {entries.map((entry) => (
                    <ElementRow key={entry.id} entry={entry} />
                  ))}
                </ul>
              </details>
            );
          })
        )}
      </div>
    </>
  );
}

function SearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="搜索元件…"
        className="h-7 w-full rounded-md border border-border/60 bg-background/50 pl-7 pr-7 text-xs placeholder:text-muted-foreground focus:border-border focus:outline-none focus:ring-1 focus:ring-ring"
        aria-label="搜索元件"
      />
      {value && (
        <button
          type="button"
          aria-label="清除搜索"
          onClick={() => onChange('')}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

function ElementRow({ entry }: { entry: LibraryEntry }) {
  const setTool = useEditorStore((s) => s.setActiveTool);
  const armed = useEditorStore(
    (s) => s.activeTool === 'place' && s.placeKind === entry.id,
  );

  const onDragStart = (e: React.DragEvent<HTMLLIElement>) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/x-oneline-kind', entry.id);
    e.dataTransfer.setData('text/plain', entry.id);
    const ghost = document.createElement('div');
    ghost.className = 'ole-glass';
    ghost.style.cssText = [
      'position:absolute',
      'top:-9999px',
      'left:-9999px',
      'width:64px',
      'height:64px',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'border-radius:12px',
      'border:1px solid var(--border)',
      'box-shadow:0 4px 12px rgba(0,0,0,0.12)',
      'color:var(--foreground)',
      'padding:8px',
    ].join(';');
    ghost.innerHTML = `<svg class="ole-symbol" viewBox="${entry.viewBox}" width="48" height="48" preserveAspectRatio="xMidYMid meet">${entry.svg}</svg>`;
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 32, 32);
    setTimeout(() => ghost.remove(), 0);
  };

  return (
    <li
      className={`group flex cursor-grab items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-accent active:cursor-grabbing ${
        armed ? 'bg-accent ring-1 ring-[var(--selection)]/60' : ''
      }`}
      draggable
      onDragStart={onDragStart}
      onClick={() => setTool('place', { placeKind: entry.id })}
      data-kind={entry.id}
      title={
        entry.description
          ? `${entry.name} — ${entry.description}`
          : `${entry.name} — 单击进入放置模式或拖到画布`
      }
    >
      <div className="flex h-7 w-12 shrink-0 items-center justify-center">
        <svg
          viewBox={entry.viewBox}
          className="ole-symbol size-full"
          preserveAspectRatio="xMidYMid meet"
          dangerouslySetInnerHTML={{ __html: entry.svg }}
        />
      </div>
      <span className="truncate text-xs text-foreground/80 group-hover:text-accent-foreground">
        {entry.name}
      </span>
    </li>
  );
}

function CountChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground/80">
      {children}
    </span>
  );
}
