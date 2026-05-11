import { useEffect, useState } from 'react';
import {
  Grid2x2,
  Maximize2,
  Minus,
  MoreHorizontal,
  Plus,
  Type,
} from 'lucide-react';
import { Button } from './ui/button';
import { Tooltip } from './ui/tooltip';
import { UpwardPopover } from './ui/upward-popover';
import {
  fitToContent,
  getViewportApi,
  getScale,
  subscribeScale,
} from '../canvas';
import { atLeast, useEditorTier, type Tier } from '../hooks/editor-tier';
import { useT } from '../i18n';
import { cn } from '../lib/utils';
import { useEditorStore } from '../store';
import type { LabelMode } from '../model';

const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8] as const;
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;

const GRID_STORAGE_KEY = 'ole-grid';

function readGrid(): boolean {
  try {
    const v = window.localStorage.getItem(GRID_STORAGE_KEY);
    return v == null ? true : v === '1';
  } catch {
    return true;
  }
}
function writeGrid(v: boolean): void {
  try {
    window.localStorage.setItem(GRID_STORAGE_KEY, v ? '1' : '0');
  } catch {
    // ignore
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function getCanvasRoot(): HTMLElement | null {
  return document.querySelector('.ole-canvas-root');
}

/** Apply a target scale, anchored at the canvas viewport center. */
function zoomTo(target: number): void {
  const api = getViewportApi();
  const root = getCanvasRoot();
  if (!api || !root) return;
  const rect = root.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const vp = api.getViewport();
  const next = clamp(target, MIN_SCALE, MAX_SCALE);
  const ratio = next / vp.scale;
  api.setViewport({
    tx: cx - (cx - vp.tx) * ratio,
    ty: cy - (cy - vp.ty) * ratio,
    scale: next,
  });
}

function zoomIn(): void {
  const api = getViewportApi();
  if (!api) return;
  const cur = api.getViewport().scale;
  const next = ZOOM_STEPS.find((z) => z > cur + 1e-6) ?? MAX_SCALE;
  zoomTo(next);
}

function zoomOut(): void {
  const api = getViewportApi();
  if (!api) return;
  const cur = api.getViewport().scale;
  let next = MIN_SCALE;
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    if (ZOOM_STEPS[i] < cur - 1e-6) {
      next = ZOOM_STEPS[i];
      break;
    }
  }
  zoomTo(next);
}

const LABEL_CYCLE: Record<LabelMode, LabelMode> = {
  off: 'id',
  id: 'all',
  all: 'off',
};

function cycleLabelMode(): void {
  const store = useEditorStore.getState();
  const cur = store.diagram.meta?.labelMode ?? 'all';
  const next = LABEL_CYCLE[cur];
  store.dispatch((d) => {
    const meta = { ...(d.meta ?? {}), labelMode: next };
    return { ...d, meta };
  });
}

/**
 * Grid state + side effects. Lives wherever the view menu is mounted (the
 * standalone ViewToolbar at wider widths, or the embedded ViewMenuButton at
 * dense+). Owns the keyboard `G` shortcut so it works regardless of whether
 * the popover happens to be open.
 */
function useGridState(): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const [grid, setGrid] = useState<boolean>(() => readGrid());

  useEffect(() => {
    const root = getCanvasRoot();
    root?.classList.toggle('hide-grid', !grid);
    writeGrid(grid);
  }, [grid]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== 'g' && e.key !== 'G') return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      setGrid((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return [grid, setGrid];
}

function ZoomOutBtn() {
  const t = useT();
  return (
    <Tooltip
      content={
        <div className="space-y-0.5">
          <div className="font-medium">{t('view.zoomOut')}</div>
          <div className="text-muted-foreground">{t('view.zoomOutHint')}</div>
        </div>
      }
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={zoomOut}
        aria-label={t('view.zoomOut')}
      >
        <Minus />
      </Button>
    </Tooltip>
  );
}

function ZoomInBtn() {
  const t = useT();
  return (
    <Tooltip
      content={
        <div className="space-y-0.5">
          <div className="font-medium">{t('view.zoomIn')}</div>
          <div className="text-muted-foreground">{t('view.zoomInHint')}</div>
        </div>
      }
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={zoomIn}
        aria-label={t('view.zoomIn')}
      >
        <Plus />
      </Button>
    </Tooltip>
  );
}

function ZoomDisplayBtn() {
  const t = useT();
  const [scale, setScale] = useState(getScale);
  useEffect(() => subscribeScale(setScale), []);
  return (
    <Tooltip
      content={
        <div className="space-y-0.5">
          <div className="font-medium">{t('view.reset')}</div>
          <div className="text-muted-foreground">
            {t('view.current', { z: Math.round(scale * 100) })}
          </div>
        </div>
      }
    >
      <button
        type="button"
        onClick={() => zoomTo(1)}
        className="min-w-12 rounded-md px-2 py-1 text-center text-xs tabular-nums text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        aria-label={t('view.reset')}
      >
        {Math.round(scale * 100)}%
      </button>
    </Tooltip>
  );
}

function FitBtn() {
  const t = useT();
  return (
    <Tooltip
      content={
        <div className="space-y-0.5">
          <div className="font-medium">{t('view.fit')}</div>
          <div className="text-muted-foreground">{t('view.fitHint')}</div>
        </div>
      }
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={fitToContent}
        aria-label={t('view.fit')}
      >
        <Maximize2 />
      </Button>
    </Tooltip>
  );
}

function GridBtn({
  grid,
  setGrid,
}: {
  grid: boolean;
  setGrid: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const t = useT();
  return (
    <Tooltip
      content={
        <div className="space-y-0.5">
          <div>
            <span className="font-medium">
              {grid ? t('view.gridHide') : t('view.gridShow')}
            </span>
            <span className="ml-1.5 text-muted-foreground">
              {t('view.gridHotkey')}
            </span>
          </div>
          <div className="text-muted-foreground">
            {grid ? t('view.gridHideHint') : t('view.gridShowHint')}
          </div>
        </div>
      }
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setGrid((v) => !v)}
        aria-label={grid ? t('view.gridHideAria') : t('view.gridShowAria')}
        aria-pressed={grid}
        className={cn(!grid && 'text-muted-foreground/60')}
      >
        <Grid2x2 />
      </Button>
    </Tooltip>
  );
}

function LabelBtn() {
  const t = useT();
  const labelMode: LabelMode = useEditorStore(
    (s) => s.diagram.meta?.labelMode ?? 'all',
  );
  return (
    <Tooltip
      content={
        <div className="space-y-0.5">
          <div className="font-medium">
            {labelMode === 'off'
              ? t('view.labelOff')
              : labelMode === 'id'
                ? t('view.labelId')
                : t('view.labelAll')}
          </div>
          <div className="text-muted-foreground">{t('view.labelHint')}</div>
        </div>
      }
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={cycleLabelMode}
        aria-label={t('view.label')}
        aria-pressed={labelMode !== 'off'}
        className={cn(labelMode === 'off' && 'text-muted-foreground/60')}
      >
        <Type />
      </Button>
    </Tooltip>
  );
}

/**
 * View menu collapsed into a single popover trigger. Designed to be embedded
 * inline inside another bar (no outer positioning). Used by FloatingToolbar
 * at `dense` and below, where it stands in for the standalone ViewToolbar.
 *
 * `stacked` switches the trigger to the unified-bar's tab-bar look (icon on
 * top, "视图" label below) so it matches the other phone-class buttons.
 */
export function ViewMenuButton({ stacked }: { stacked?: boolean } = {}) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const [grid, setGrid] = useGridState();
  const tipContent = (
    <div className="space-y-0.5">
      <div className="font-medium">{t('view.menu')}</div>
      <div className="text-muted-foreground">{t('view.menuHint')}</div>
    </div>
  );
  const triggerBtn = stacked ? (
    <Tooltip content={tipContent}>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label={t('view.menu')}
        aria-pressed={menuOpen}
        className={cn(
          'flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-md text-[10px] font-medium leading-tight transition-colors',
          menuOpen
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )}
      >
        <MoreHorizontal className="size-4" />
        <span className="max-w-full truncate">{t('view.menu')}</span>
      </button>
    </Tooltip>
  ) : (
    <Tooltip content={tipContent}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label={t('view.menu')}
        aria-pressed={menuOpen}
      >
        <MoreHorizontal />
      </Button>
    </Tooltip>
  );
  return (
    <UpwardPopover
      open={menuOpen}
      onOpenChange={setMenuOpen}
      trigger={triggerBtn}
    >
      <div className="flex flex-col gap-0.5">
        <ZoomDisplayBtn />
        <div className="flex items-center gap-0.5">
          <ZoomOutBtn />
          <ZoomInBtn />
        </div>
        <div aria-hidden className="my-1 h-px bg-border" />
        <div className="flex items-center gap-0.5">
          <FitBtn />
          <GridBtn grid={grid} setGrid={setGrid} />
          <LabelBtn />
        </div>
      </div>
    </UpwardPopover>
  );
}

/**
 * Bottom-right view toolbar. Above `dense` (>520px) it renders an expanded
 * row with explicit zoom controls. At `dense` and below it returns null —
 * its content is rendered as an embedded ViewMenuButton inside the unified
 * FloatingToolbar bottom bar so the chrome stays on a single line.
 */
export function ViewToolbar() {
  const tier = useEditorTier();
  if (atLeast(tier, 'dense')) return null;
  return <ViewToolbarExpanded tier={tier} />;
}

function ViewToolbarExpanded({ tier }: { tier: Tier }) {
  // Hide the zoom-% pill from `tight` (≥720 < 900) onward — that's where the
  // centered FloatingToolbar starts colliding with this right-anchored bar.
  const hidePercentPill = atLeast(tier, 'tight');
  const [grid, setGrid] = useGridState();

  return (
    <div
      className="absolute z-20"
      style={{
        bottom: 'calc(0.75rem + var(--ole-bottom-inset, 0px))',
        right: 'calc(0.75rem + env(safe-area-inset-right, 0px))',
      }}
    >
      <div className="ole-glass flex items-center gap-0.5 rounded-2xl border border-border p-1.5 shadow-sm">
        <ZoomOutBtn />
        {!hidePercentPill && <ZoomDisplayBtn />}
        <ZoomInBtn />
        <div aria-hidden className="mx-1 h-4 w-px bg-border" />
        <FitBtn />
        <GridBtn grid={grid} setGrid={setGrid} />
        <LabelBtn />
      </div>
    </div>
  );
}
