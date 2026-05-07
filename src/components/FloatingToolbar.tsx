import { Fragment, useEffect, useRef, useState } from 'react';
import {
  Cable,
  Hand,
  LayoutGrid,
  Minus,
  MousePointer2,
  Redo2,
  Shapes,
  Undo2,
  Wand2,
} from 'lucide-react';
import { Tooltip } from './ui/tooltip';
import { useT, type LocaleKey } from '../i18n';
import { cn } from '../lib/utils';
import { useEditorStore, type ToolId } from '../store';

interface ToolDef {
  id: string;
  labelKey: LocaleKey;
  hotkey: string;
  descriptionKey: LocaleKey;
  icon: React.ComponentType<{ className?: string }>;
  /** Render a divider after this tool (visually groups the toolbar). */
  groupBreakAfter?: boolean;
  /** Tool action: switch active tool (with optional placeKind preset). */
  switchTo: ToolId;
  /**
   * `undefined` = keep current placeKind; `null` = clear; string = preset.
   */
  presetPlaceKind?: string | null;
  /** Icon-only render (label still goes to aria-label / tooltip). */
  iconOnly?: boolean;
}

const TOOLS: ToolDef[] = [
  {
    id: 'select',
    labelKey: 'tool.select',
    hotkey: 'V',
    descriptionKey: 'tool.selectHint',
    icon: MousePointer2,
    switchTo: 'select',
    iconOnly: true,
  },
  {
    id: 'pan',
    labelKey: 'tool.pan',
    hotkey: 'H',
    descriptionKey: 'tool.panHint',
    icon: Hand,
    switchTo: 'pan',
    groupBreakAfter: true,
    iconOnly: true,
  },
  {
    id: 'wire',
    labelKey: 'tool.wire',
    hotkey: 'W',
    descriptionKey: 'tool.wireHint',
    icon: Cable,
    switchTo: 'wire',
  },
  {
    id: 'busbar',
    labelKey: 'tool.bus',
    hotkey: 'B',
    descriptionKey: 'tool.busHint',
    icon: Minus,
    switchTo: 'busbar',
  },
  {
    id: 'place',
    labelKey: 'tool.place',
    hotkey: 'P',
    descriptionKey: 'tool.placeHint',
    icon: Shapes,
    switchTo: 'place',
  },
];

/**
 * Short usage hint shown above the toolbar for whichever tool is active.
 * Keeps users oriented without forcing them to discover a tooltip — most
 * tools have a non-obvious gesture and the hint paid off in usability tests.
 */
function ToolHint() {
  const t = useT();
  const active = useEditorStore((s) => s.activeTool);
  const placeKind = useEditorStore((s) => s.placeKind);
  const placeFrom = useEditorStore((s) => s.placeFromTerminal);
  const wireFrom = useEditorStore((s) => s.wireFromTerminal);
  const busbarStart = useEditorStore((s) => s.busbarDrawStart);
  const hasSelection = useEditorStore(
    (s) => s.selection.length > 0 || s.selectedNode != null,
  );

  let text: string | null = null;
  let cancelHint = false;
  switch (active) {
    case 'select':
      text = hasSelection
        ? t('mode.selectWithSel')
        : t('mode.selectEmpty');
      if (hasSelection) cancelHint = true;
      break;
    case 'pan':
      text = t('mode.pan');
      break;
    case 'wire':
      text = wireFrom ? t('mode.wireDragging') : t('mode.wireInit');
      cancelHint = true;
      break;
    case 'busbar':
      text = busbarStart ? t('mode.busDragging') : t('mode.busInit');
      cancelHint = true;
      break;
    case 'place':
      if (!placeKind) text = t('mode.placeNoKind');
      else if (placeFrom) text = t('mode.placeFromTerm');
      else text = t('mode.placeNormal');
      cancelHint = true;
      break;
  }
  if (!text) return null;
  // In select mode right-click opens the context menu rather than cancelling,
  // so only Esc clears the selection. In drawing tools right-click also cancels.
  const cancelText = active === 'select' ? t('mode.escSelect') : t('mode.escOther');
  return (
    <div className="ole-glass pointer-events-none flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground shadow-sm">
      <span>{text}</span>
      {cancelHint && <span className="text-muted-foreground/70">· {cancelText}</span>}
    </div>
  );
}

export function FloatingToolbar() {
  const t = useT();
  const active = useEditorStore((s) => s.activeTool);
  const placeKind = useEditorStore((s) => s.placeKind);
  const setTool = useEditorStore((s) => s.setActiveTool);
  const past = useEditorStore((s) => s.past.length);
  const future = useEditorStore((s) => s.future.length);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  const isToolActive = (def: ToolDef): boolean => active === def.switchTo;

  return (
    <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-1.5">
      <ToolHint />
      <div className="ole-glass flex flex-row items-center gap-0.5 rounded-2xl border border-border p-1.5 shadow-sm">
        {TOOLS.map((def) => {
          const Icon = def.icon;
          const isActive = isToolActive(def);
          const tip =
            def.id === 'place' && isActive && placeKind == null
              ? t('tool.placeNoKindTooltip')
              : t(def.descriptionKey);
          return (
            <Fragment key={def.id}>
              <ToolbarButton
                icon={Icon}
                label={t(def.labelKey)}
                hotkey={def.hotkey}
                active={isActive}
                iconOnly={def.iconOnly}
                description={tip}
                onClick={() => {
                  setTool(def.switchTo, {
                    placeKind:
                      def.presetPlaceKind !== undefined ? def.presetPlaceKind : undefined,
                  });
                }}
              />
              {def.groupBreakAfter && (
                <div aria-hidden className="mx-1 h-5 w-px bg-border" />
              )}
            </Fragment>
          );
        })}
        <div aria-hidden className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton
          icon={Undo2}
          label={t('tool.undo')}
          hotkey="⌘Z"
          description={t('tool.undoHint')}
          iconOnly
          disabled={past === 0}
          onClick={undo}
        />
        <ToolbarButton
          icon={Redo2}
          label={t('tool.redo')}
          hotkey="⌘⇧Z"
          description={t('tool.redoHint')}
          iconOnly
          disabled={future === 0}
          onClick={redo}
        />
        <div aria-hidden className="mx-1 h-5 w-px bg-border" />
        <LayoutMenuButton />
      </div>
    </div>
  );
}

/**
 * Toolbar button: icon + label, with a small hotkey hint pinned to the
 * top-left corner. Active = filled (primary). Disabled = dimmed.
 */
function ToolbarButton({
  icon: Icon,
  label,
  hotkey,
  active,
  disabled,
  iconOnly,
  onClick,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hotkey?: string;
  active?: boolean;
  disabled?: boolean;
  iconOnly?: boolean;
  onClick: () => void;
  description?: React.ReactNode;
}) {
  const tipContent = (
    <div className="space-y-0.5">
      <div>
        <span className="font-medium">{label}</span>
        {hotkey && (
          <span className="ml-1.5 text-muted-foreground">{hotkey}</span>
        )}
      </div>
      {description && <div className="text-muted-foreground">{description}</div>}
    </div>
  );
  return (
    <Tooltip content={tipContent} disabled={disabled}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          'flex h-9 items-center gap-1.5 rounded-md text-xs font-medium transition-colors',
          iconOnly ? 'w-9 justify-center' : 'px-2.5',
          active
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          disabled && 'pointer-events-none opacity-40',
        )}
      >
        <span className="relative inline-flex shrink-0">
          <Icon className="size-4" />
          {hotkey && (
            <span
              aria-hidden
              className={cn(
                'pointer-events-none absolute -right-1.5 -top-1.5 rounded-sm px-1 font-mono text-[8px] leading-[1.1]',
                active
                  ? 'bg-primary-foreground/20 text-primary-foreground/85'
                  : 'bg-foreground/10 text-muted-foreground',
              )}
            >
              {hotkey}
            </span>
          )}
        </span>
        {!iconOnly && <span>{label}</span>}
      </button>
    </Tooltip>
  );
}

function LayoutMenuButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Subscribe at field-level so disabled state stays live while menu is open.
  const elements = useEditorStore((s) => s.diagram.elements);
  const layout = useEditorStore((s) => s.diagram.layout);
  const selection = useEditorStore((s) => s.selection);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const explicit = layout ?? {};
  const hasAnyElement = elements.length > 0;
  const hasArrangedAny = Object.keys(explicit).length > 0;
  const hasGapsAll = elements.some((el) => !explicit[el.id]);
  const hasSelection = selection.length > 0;
  const selectionHasArranged = selection.some((id) => !!explicit[id]);
  const selectionHasGaps = selection.some((id) => !explicit[id]);

  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div ref={ref} className="relative">
      <ToolbarButton
        icon={Wand2}
        label={t('layout.label')}
        description={t('layout.hint')}
        active={open}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <div
          role="menu"
          // Toolbar lives at bottom of screen — open menu upward.
          className="ole-glass absolute bottom-full right-0 mb-1.5 min-w-52 rounded-md border border-border p-1 shadow-md"
        >
          <PopoverItem
            onClick={run(() => useEditorStore.getState().autoArrangeAll())}
            icon={<Wand2 />}
            disabled={!hasAnyElement || !hasArrangedAny}
          >
            {t('layout.allAuto')}
          </PopoverItem>
          <PopoverItem
            onClick={run(() => useEditorStore.getState().autoArrangeSelection())}
            icon={<Wand2 />}
            disabled={!hasSelection || !selectionHasArranged}
          >
            {t('layout.selAuto')}
          </PopoverItem>
          <div aria-hidden className="my-1 h-px bg-border" />
          <PopoverItem
            onClick={run(() => useEditorStore.getState().fillUnplacedAll())}
            icon={<LayoutGrid />}
            disabled={!hasGapsAll}
          >
            {t('layout.allFill')}
          </PopoverItem>
          <PopoverItem
            onClick={run(() => useEditorStore.getState().fillUnplacedSelection())}
            icon={<LayoutGrid />}
            disabled={!hasSelection || !selectionHasGaps}
          >
            {t('layout.selFill')}
          </PopoverItem>
        </div>
      )}
    </div>
  );
}

function PopoverItem({
  children,
  icon,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground [&>svg]:size-4',
        disabled &&
          'pointer-events-none text-muted-foreground opacity-60 hover:bg-transparent',
      )}
    >
      {icon}
      <span className="flex-1">{children}</span>
    </button>
  );
}
