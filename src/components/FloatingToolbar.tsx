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
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useEditorStore, type ToolId } from '@/store';

interface ToolDef {
  id: string;
  label: string;
  hotkey: string;
  description: string;
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
    label: '选择',
    hotkey: 'V',
    description: '点选元件，框选多个，或右键打开菜单',
    icon: MousePointer2,
    switchTo: 'select',
    iconOnly: true,
  },
  {
    id: 'pan',
    label: '平移',
    hotkey: 'H',
    description: '拖动画布；空格键可临时切换',
    icon: Hand,
    switchTo: 'pan',
    groupBreakAfter: true,
    iconOnly: true,
  },
  {
    id: 'wire',
    label: '连线',
    hotkey: 'W',
    description: '从一个端子拖动到另一个端子完成连线',
    icon: Cable,
    switchTo: 'wire',
  },
  {
    id: 'busbar',
    label: '母线',
    hotkey: 'B',
    description: '画布上拖动一段母线，按下定起点、释放定终点',
    icon: Minus,
    switchTo: 'busbar',
  },
  {
    id: 'place',
    label: '元件',
    hotkey: 'P',
    description: '点击画布放置；或从端子/母线拖出，同时放置并连接',
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
      text = '点选元件 · 拖动移动 · 框选多个 · 右键打开菜单';
      if (hasSelection) cancelHint = true;
      break;
    case 'pan':
      text = '拖动画布 · 滚轮缩放 · 按住空格可在其他工具下临时平移';
      break;
    case 'wire':
      text = wireFrom
        ? '拖到另一个端子或母线上释放完成连线'
        : '从端子按下，拖动到另一个端子或母线上释放';
      cancelHint = true;
      break;
    case 'busbar':
      text = busbarStart
        ? '拖动决定母线方向，释放定终点'
        : '在画布按下定起点，拖动后释放定终点';
      cancelHint = true;
      break;
    case 'place':
      if (!placeKind) {
        text = '从左侧元件库选择一种元件';
      } else if (placeFrom) {
        text = '拖到目标位置释放，新元件将连接到起点端子';
        cancelHint = true;
      } else {
        text = '点击空白放置；或从已有端子 / 母线拖出，同时放置并连接';
        cancelHint = true;
      }
      break;
  }
  if (!text) return null;
  // In select mode right-click opens the context menu rather than cancelling,
  // so only Esc clears the selection. In drawing tools right-click also cancels.
  const cancelText = active === 'select' ? 'Esc 清除选择' : '右键 / Esc 取消';
  return (
    <div className="ole-glass pointer-events-none flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground shadow-sm">
      <span>{text}</span>
      {cancelHint && <span className="text-muted-foreground/70">· {cancelText}</span>}
    </div>
  );
}

export function FloatingToolbar() {
  const active = useEditorStore((s) => s.activeTool);
  const placeKind = useEditorStore((s) => s.placeKind);
  const setTool = useEditorStore((s) => s.setActiveTool);
  const past = useEditorStore((s) => s.past.length);
  const future = useEditorStore((s) => s.future.length);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  const isToolActive = (t: ToolDef): boolean => active === t.switchTo;

  return (
    <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-1.5">
      <ToolHint />
      <div className="ole-glass flex flex-row items-center gap-0.5 rounded-2xl border border-border p-1.5 shadow-sm">
        {TOOLS.map((t) => {
          const Icon = t.icon;
          const isActive = isToolActive(t);
          const tip =
            t.id === 'place' && isActive && placeKind == null
              ? '从左侧元件库选择一个元件后点击画布放置'
              : t.description;
          return (
            <Fragment key={t.id}>
              <ToolbarButton
                icon={Icon}
                label={t.label}
                hotkey={t.hotkey}
                active={isActive}
                iconOnly={t.iconOnly}
                description={tip}
                onClick={() => {
                  setTool(t.switchTo, {
                    placeKind:
                      t.presetPlaceKind !== undefined ? t.presetPlaceKind : undefined,
                  });
                }}
              />
              {t.groupBreakAfter && (
                <div aria-hidden className="mx-1 h-5 w-px bg-border" />
              )}
            </Fragment>
          );
        })}
        <div aria-hidden className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton
          icon={Undo2}
          label="撤销"
          hotkey="⌘Z"
          description="撤销上一次编辑（移动 / 旋转 / 删除等）"
          iconOnly
          disabled={past === 0}
          onClick={undo}
        />
        <ToolbarButton
          icon={Redo2}
          label="重做"
          hotkey="⌘⇧Z"
          description="重做被撤销的操作"
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
        label="布局"
        description="自动排版整个图或仅选中范围，并填补空缺"
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
            重新自动布局
          </PopoverItem>
          <PopoverItem
            onClick={run(() => useEditorStore.getState().autoArrangeSelection())}
            icon={<Wand2 />}
            disabled={!hasSelection || !selectionHasArranged}
          >
            重新自动布局选区
          </PopoverItem>
          <div aria-hidden className="my-1 h-px bg-border" />
          <PopoverItem
            onClick={run(() => useEditorStore.getState().fillUnplacedAll())}
            icon={<LayoutGrid />}
            disabled={!hasGapsAll}
          >
            填补未排版位置
          </PopoverItem>
          <PopoverItem
            onClick={run(() => useEditorStore.getState().fillUnplacedSelection())}
            icon={<LayoutGrid />}
            disabled={!hasSelection || !selectionHasGaps}
          >
            填补未排版选区
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
