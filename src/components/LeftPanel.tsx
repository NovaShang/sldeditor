import { ListTree, PanelBottomClose } from 'lucide-react';
import { libraryById } from '../element-library';
import { atLeast, useEditorTier } from '../hooks/editor-tier';
import { usePanels } from '../hooks/use-panels';
import { useT } from '../i18n';
import { cn } from '../lib/utils';
import { useEditorStore } from '../store';
import type { Element } from '../model';

export function LeftPanel() {
  const open = usePanels((s) => s.outlineOpen);
  const setOpen = usePanels((s) => s.setOutlineOpen);
  const tier = useEditorTier();
  const dense = atLeast(tier, 'dense');

  // At dense+ the collapsed tab is replaced by an outline button embedded
  // directly into the FloatingToolbar bottom bar. The outline panel itself
  // still lives here but switches to a full-width bottom sheet anchored just
  // above that bar so it doesn't compete for horizontal room with the canvas.
  if (dense) {
    if (!open) return null;
    return (
      <div
        className="absolute z-10"
        style={{
          left: 'calc(0.75rem + var(--ole-left-inset, 0px))',
          right: 'calc(0.75rem + var(--ole-right-inset, 0px))',
          bottom: 'calc(4rem + var(--ole-bottom-inset, 0px) + 0.75rem)',
        }}
      >
        <OutlinePanel onClose={() => setOpen(false)} sheet />
      </div>
    );
  }

  return (
    <div
      className="absolute z-10 flex flex-col items-start"
      style={{
        bottom: 'calc(0.75rem + var(--ole-bottom-inset, 0px))',
        left: 'calc(0.75rem + var(--ole-left-inset, 0px))',
        maxHeight: 'calc(100% - 1.5rem)',
      }}
    >
      {open ? (
        <OutlinePanel onClose={() => setOpen(false)} />
      ) : (
        <CollapsedTab onClick={() => setOpen(true)} />
      )}
    </div>
  );
}

function CollapsedTab({ onClick }: { onClick: () => void }) {
  const t = useT();
  const tier = useEditorTier();
  const compact = atLeast(tier, 'compact');
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('outline.title')}
      title={t('outline.title')}
      className={cn(
        'ole-glass flex h-12 items-center rounded-2xl border border-border text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground',
        compact ? 'w-12 justify-center' : 'gap-2 px-3',
      )}
    >
      <ListTree className="size-4 shrink-0" />
      {!compact && <span className="text-xs font-medium">{t('outline.title')}</span>}
    </button>
  );
}

function OutlinePanel({
  onClose,
  sheet,
}: {
  onClose: () => void;
  sheet?: boolean;
}) {
  const t = useT();
  const elements = useEditorStore((s) => s.diagram.elements);
  const libraryOpen = useEditorStore((s) => s.activeTool === 'place');
  const tier = useEditorTier();
  const compact = atLeast(tier, 'compact');
  const dense = atLeast(tier, 'dense');
  // Use `height` (not `max-height`) so the panel always reserves space,
  // even when content is short. In sheet mode it sizes by the parent's
  // left/right anchor — we just cap the height so the canvas above stays
  // visible.
  const height = sheet
    ? 'min(50vh, calc(100vh - 9rem))'
    : libraryOpen
      ? 'min(40vh, calc(100vh - 200px))'
      : 'min(70vh, calc(100vh - 100px))';
  return (
    <aside
      className={cn(
        'ole-glass flex flex-col overflow-hidden rounded-2xl border border-border shadow-sm',
        sheet ? 'w-full' : compact ? 'w-52' : 'w-64',
      )}
      style={{ height }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t('outline.collapseAria')}
        title={t('outline.collapse')}
        className="flex items-center gap-1.5 border-b border-border/40 px-3 py-2 text-left transition-colors hover:bg-muted/40"
      >
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('outline.title')}
        </span>
        {!dense && <CountChip>{elements.length}</CountChip>}
        <PanelBottomClose className="size-3.5 text-muted-foreground" />
      </button>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {elements.length === 0 ? (
          <p className="px-2 py-2 text-xs italic text-muted-foreground">
            {t('outline.empty')}
          </p>
        ) : (
          <ul className="space-y-px">
            {elements.map((el) => (
              <OutlineRow key={el.id} element={el} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function OutlineRow({ element }: { element: Element }) {
  const lib = libraryById[element.kind];
  const selected = useEditorStore((s) => s.selection.includes(element.id));
  const setSelection = useEditorStore((s) => s.setSelection);
  const toggleInSelection = useEditorStore((s) => s.toggleInSelection);
  const tier = useEditorTier();
  const showId = !atLeast(tier, 'compact');
  const onClick = (e: React.MouseEvent) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) toggleInSelection(element.id);
    else setSelection([element.id]);
  };
  return (
    <li
      className="group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-accent data-[selected=true]:bg-[color-mix(in_oklch,var(--selection)_18%,transparent)]"
      title={element.note ?? `${element.name ?? element.id} (${element.kind})`}
      data-element-id={element.id}
      data-selected={selected ? 'true' : undefined}
      onClick={onClick}
    >
      <div className="flex h-4 w-6 shrink-0 items-center justify-center">
        {lib && (
          <svg
            viewBox={lib.viewBox}
            className="ole-symbol size-full"
            preserveAspectRatio="xMidYMid meet"
            dangerouslySetInnerHTML={{ __html: lib.svg }}
          />
        )}
      </div>
      <span className="flex-1 truncate text-xs text-foreground/90 group-hover:text-accent-foreground">
        {element.name ?? element.id}
      </span>
      {showId && (
        <span className="font-mono text-[10px] text-muted-foreground/80">
          {element.id}
        </span>
      )}
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
