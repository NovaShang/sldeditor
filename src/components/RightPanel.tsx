import { libraryById } from '../element-library';
import { atLeast, useEditorTier } from '../hooks/editor-tier';
import { useT } from '../i18n';
import { useLibT } from '../i18n/library';
import { cn } from '../lib/utils';
import { useEditorStore } from '../store';
import { PropertyPanel } from './PropertyPanel';

export function RightPanel() {
  const t = useT();
  const libT = useLibT();
  const selection = useEditorStore((s) => s.selection);
  const selectedNode = useEditorStore((s) => s.selectedNode);
  const elements = useEditorStore((s) => s.diagram.elements);
  const tier = useEditorTier();
  // On narrow viewports the panel competes with the host's top chrome
  // (e.g., DemoTopBar). Trim its width so both can coexist on iPhone.
  const compactWidth = atLeast(tier, 'dense');

  // Hidden when nothing selected — the contextual toolbar handles transient
  // actions; the right panel exists only to edit the selected target.
  if (selection.length === 0 && !selectedNode) return null;

  let title = t('props.title');
  let count: number | null = null;
  if (selectedNode) {
    title = t('props.node');
  } else if (selection.length === 1) {
    const el = elements.find((e) => e.id === selection[0]);
    if (el) {
      const lib = libraryById[el.kind];
      title = lib ? libT(`${lib.id}.name`, lib.name) : el.kind;
    }
  } else {
    count = selection.length;
  }

  return (
    <aside
      className={cn(
        'ole-glass absolute z-10 flex flex-col overflow-hidden rounded-2xl border border-border shadow-sm',
        compactWidth ? 'w-48' : 'w-56',
      )}
      style={{
        top: `calc(${compactWidth ? '4.5rem' : '0.75rem'} + var(--ole-top-inset, 0px))`,
        right: 'calc(0.75rem + var(--ole-right-inset, 0px))',
        maxHeight: `calc(100% - ${compactWidth ? '5.25rem' : '1.5rem'} - var(--ole-top-inset, 0px) - var(--ole-bottom-inset, 0px) - 4.5rem)`,
      }}
    >
      <div className="flex items-center gap-1.5 border-b border-border/40 px-3 py-2">
        <span className="flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        {count != null && (
          <span className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground/80">
            {t('props.nSelected', { n: count })}
          </span>
        )}
      </div>
      <PropertyPanel />
    </aside>
  );
}
