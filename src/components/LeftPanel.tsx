import { ListTree, PanelBottomClose } from 'lucide-react';
import { libraryById } from '@/element-library';
import { usePanels } from '@/hooks/use-panels';
import { useEditorStore } from '@/store';
import type { Element } from '@/model';

export function LeftPanel() {
  const open = usePanels((s) => s.outlineOpen);
  const setOpen = usePanels((s) => s.setOutlineOpen);

  return (
    <div
      className="absolute bottom-3 left-3 z-10 flex flex-col items-start"
      style={{ maxHeight: 'calc(100% - 1.5rem)' }}
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
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="大纲"
      title="大纲"
      className="ole-glass flex h-12 items-center gap-2 rounded-2xl border border-border px-3 text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <ListTree className="size-4 shrink-0" />
      <span className="text-xs font-medium">大纲</span>
    </button>
  );
}

function OutlinePanel({ onClose }: { onClose: () => void }) {
  const elements = useEditorStore((s) => s.diagram.elements);
  const libraryOpen = useEditorStore((s) => s.activeTool === 'place');
  // Use `height` (not `max-height`) so the panel always reserves space,
  // even when content is short. Default tall; library-open is shorter.
  const height = libraryOpen
    ? 'min(40vh, calc(100vh - 200px))'
    : 'min(70vh, calc(100vh - 100px))';
  return (
    <aside
      className="ole-glass flex w-64 flex-col overflow-hidden rounded-2xl border border-border shadow-sm"
      style={{ height }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="折叠大纲"
        title="折叠"
        className="flex items-center gap-1.5 border-b border-border/40 px-3 py-2 text-left transition-colors hover:bg-muted/40"
      >
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          大纲
        </span>
        <CountChip>{elements.length}</CountChip>
        <PanelBottomClose className="size-3.5 text-muted-foreground" />
      </button>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {elements.length === 0 ? (
          <p className="px-2 py-2 text-xs italic text-muted-foreground">
            （无设备 — 从元件库拖入开始）
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
  return (
    <li
      className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent"
      title={element.note ?? `${element.name ?? element.id} (${element.kind})`}
      data-element-id={element.id}
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
      <span className="font-mono text-[10px] text-muted-foreground/80">
        {element.id}
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
