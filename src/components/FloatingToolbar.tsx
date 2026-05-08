import { Fragment, useState } from 'react';
import {
  Cable,
  Hand,
  LayoutGrid,
  Minus,
  MoreHorizontal,
  MousePointer2,
  Redo2,
  Shapes,
  Undo2,
  Wand2,
} from 'lucide-react';
import { Tooltip } from './ui/tooltip';
import { UpwardPopover } from './ui/upward-popover';
import { atLeast, useEditorTier } from '../hooks/editor-tier';
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
  {
    id: 'wire',
    labelKey: 'tool.wire',
    hotkey: 'W',
    descriptionKey: 'tool.wireHint',
    icon: Cable,
    switchTo: 'wire',
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
  const tier = useEditorTier();
  // Drop labels from `tight` (≥720 < 900) so the centered main toolbar stops
  // colliding with the right-anchored ViewToolbar. The outline tab on the
  // left still has room for its label until `compact`.
  const forceIconOnly = atLeast(tier, 'tight');
  const showHint = !atLeast(tier, 'dense');
  const groupCollapsed = atLeast(tier, 'mini');

  const isToolActive = (def: ToolDef): boolean => active === def.switchTo;

  return (
    <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-1.5">
      {showHint && <ToolHint />}
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
                iconOnly={def.iconOnly || forceIconOnly}
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
        {groupCollapsed ? (
          <OverflowMenuButton />
        ) : (
          <>
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
            <LayoutMenuButton iconOnly={forceIconOnly} />
          </>
        )}
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

function useLayoutActions() {
  const elements = useEditorStore((s) => s.diagram.elements);
  const layout = useEditorStore((s) => s.diagram.layout);
  const selection = useEditorStore((s) => s.selection);
  const explicit = layout ?? {};
  return {
    hasAnyElement: elements.length > 0,
    hasArrangedAny: Object.keys(explicit).length > 0,
    hasGapsAll: elements.some((el) => !explicit[el.id]),
    hasSelection: selection.length > 0,
    selectionHasArranged: selection.some((id) => !!explicit[id]),
    selectionHasGaps: selection.some((id) => !explicit[id]),
  };
}

function LayoutMenuButton({ iconOnly }: { iconOnly?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // Subscribe at field-level so disabled state stays live while menu is open.
  const a = useLayoutActions();
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  return (
    <UpwardPopover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <ToolbarButton
          icon={Wand2}
          label={t('layout.label')}
          description={t('layout.hint')}
          active={open}
          iconOnly={iconOnly}
          onClick={() => setOpen((v) => !v)}
        />
      }
    >
      <PopoverItem
        onClick={run(() => useEditorStore.getState().autoArrangeAll())}
        icon={<Wand2 />}
        disabled={!a.hasAnyElement || !a.hasArrangedAny}
      >
        {t('layout.allAuto')}
      </PopoverItem>
      <PopoverItem
        onClick={run(() => useEditorStore.getState().autoArrangeSelection())}
        icon={<Wand2 />}
        disabled={!a.hasSelection || !a.selectionHasArranged}
      >
        {t('layout.selAuto')}
      </PopoverItem>
      <div aria-hidden className="my-1 h-px bg-border" />
      <PopoverItem
        onClick={run(() => useEditorStore.getState().fillUnplacedAll())}
        icon={<LayoutGrid />}
        disabled={!a.hasGapsAll}
      >
        {t('layout.allFill')}
      </PopoverItem>
      <PopoverItem
        onClick={run(() => useEditorStore.getState().fillUnplacedSelection())}
        icon={<LayoutGrid />}
        disabled={!a.hasSelection || !a.selectionHasGaps}
      >
        {t('layout.selFill')}
      </PopoverItem>
    </UpwardPopover>
  );
}

/**
 * Mini-tier substitute for [Undo, Redo, Layout]: one icon button collapsing
 * those three groups into a single popover. Layout actions are inlined here
 * (not nested inside the popover via a sub-menu) so users only deal with one
 * level of overlay on a tiny screen.
 */
function OverflowMenuButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const past = useEditorStore((s) => s.past.length);
  const future = useEditorStore((s) => s.future.length);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const a = useLayoutActions();
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  return (
    <UpwardPopover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <ToolbarButton
          icon={MoreHorizontal}
          label={t('tool.more')}
          description={t('tool.moreHint')}
          active={open}
          iconOnly
          onClick={() => setOpen((v) => !v)}
        />
      }
    >
      <PopoverItem
        onClick={run(undo)}
        icon={<Undo2 />}
        disabled={past === 0}
      >
        {t('tool.undo')}
      </PopoverItem>
      <PopoverItem
        onClick={run(redo)}
        icon={<Redo2 />}
        disabled={future === 0}
      >
        {t('tool.redo')}
      </PopoverItem>
      <div aria-hidden className="my-1 h-px bg-border" />
      <PopoverItem
        onClick={run(() => useEditorStore.getState().autoArrangeAll())}
        icon={<Wand2 />}
        disabled={!a.hasAnyElement || !a.hasArrangedAny}
      >
        {t('layout.allAuto')}
      </PopoverItem>
      <PopoverItem
        onClick={run(() => useEditorStore.getState().autoArrangeSelection())}
        icon={<Wand2 />}
        disabled={!a.hasSelection || !a.selectionHasArranged}
      >
        {t('layout.selAuto')}
      </PopoverItem>
      <PopoverItem
        onClick={run(() => useEditorStore.getState().fillUnplacedAll())}
        icon={<LayoutGrid />}
        disabled={!a.hasGapsAll}
      >
        {t('layout.allFill')}
      </PopoverItem>
      <PopoverItem
        onClick={run(() => useEditorStore.getState().fillUnplacedSelection())}
        icon={<LayoutGrid />}
        disabled={!a.hasSelection || !a.selectionHasGaps}
      >
        {t('layout.selFill')}
      </PopoverItem>
    </UpwardPopover>
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
