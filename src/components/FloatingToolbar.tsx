import { Fragment } from 'react';
import {
  Cable,
  Hand,
  Minus,
  MousePointer2,
  Redo2,
  Shapes,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { usePanels } from '@/hooks/use-panels';
import { useEditorStore, type ToolId } from '@/store';

interface ToolDef {
  id: string;
  label: string;
  hotkey: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Render a divider after this tool (visually groups the toolbar). */
  groupBreakAfter?: boolean;
  /** Tool action: switch active tool (with optional placeKind preset). */
  switchTo: ToolId;
  /**
   * `undefined` = keep current placeKind; `null` = clear; string = preset.
   */
  presetPlaceKind?: string | null;
}

const TOOLS: ToolDef[] = [
  { id: 'select', label: '选择', hotkey: 'V', icon: MousePointer2, switchTo: 'select' },
  { id: 'pan', label: '平移', hotkey: 'H', icon: Hand, switchTo: 'pan', groupBreakAfter: true },
  { id: 'wire', label: '连线', hotkey: 'W', icon: Cable, switchTo: 'wire' },
  {
    id: 'busbar',
    label: '母线',
    hotkey: 'B',
    icon: Minus,
    switchTo: 'place',
    presetPlaceKind: 'busbar',
  },
  { id: 'place', label: '放置元件', hotkey: 'P', icon: Shapes, switchTo: 'place' },
];

export function FloatingToolbar() {
  const active = useEditorStore((s) => s.activeTool);
  const placeKind = useEditorStore((s) => s.placeKind);
  const setTool = useEditorStore((s) => s.setActiveTool);
  const past = useEditorStore((s) => s.past.length);
  const future = useEditorStore((s) => s.future.length);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const libraryOpen = usePanels((s) => s.libraryOpen);
  const toggleLibrary = usePanels((s) => s.toggleLibrary);

  const isToolActive = (t: ToolDef): boolean => {
    if (t.id === 'busbar') return active === 'place' && placeKind === 'busbar';
    // The "place" button now controls the element library popover; its
    // active state reflects whether the library is open. Picking a kind
    // from the library separately activates the place tool.
    if (t.id === 'place') return libraryOpen;
    return active === t.switchTo;
  };

  return (
    <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
      <div className="ole-glass flex flex-row items-center gap-0.5 rounded-2xl border border-border p-1.5 shadow-sm">
        {TOOLS.map((t) => {
          const Icon = t.icon;
          const isActive = isToolActive(t);
          const tip =
            t.id === 'place' && isActive && placeKind == null
              ? '从左侧元件库选择一个元件后点击画布放置'
              : `${t.label} (${t.hotkey})`;
          return (
            <Fragment key={t.id}>
              <Button
                variant={isActive ? 'default' : 'ghost'}
                size="icon"
                aria-label={t.label}
                aria-pressed={isActive}
                title={tip}
                onClick={() => {
                  if (t.id === 'place') {
                    toggleLibrary();
                    return;
                  }
                  setTool(t.switchTo, {
                    placeKind:
                      t.presetPlaceKind !== undefined ? t.presetPlaceKind : undefined,
                  });
                }}
                className={cn(!isActive && 'text-muted-foreground')}
              >
                <Icon />
              </Button>
              {t.groupBreakAfter && (
                <div aria-hidden className="mx-1 h-5 w-px bg-border" />
              )}
            </Fragment>
          );
        })}
        <div aria-hidden className="mx-1 h-5 w-px bg-border" />
        <Button
          variant="ghost"
          size="icon"
          aria-label="撤销"
          title="撤销 (⌘Z)"
          disabled={past === 0}
          onClick={undo}
          className={cn(past === 0 ? 'text-muted-foreground/40' : 'text-muted-foreground')}
        >
          <Undo2 />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="重做"
          title="重做 (⌘⇧Z)"
          disabled={future === 0}
          onClick={redo}
          className={cn(
            future === 0 ? 'text-muted-foreground/40' : 'text-muted-foreground',
          )}
        >
          <Redo2 />
        </Button>
      </div>
    </div>
  );
}
