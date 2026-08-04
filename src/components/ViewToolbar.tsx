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
import {
  LABEL_FONT_SIZE,
  LABEL_FONT_SIZE_MAX,
  LABEL_FONT_SIZE_MIN,
  resolveLabelFontSize,
} from '../lib/element-labels';
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

/**
 * Label type sizes offered by the size stepper, in canvas units. A ladder
 * rather than ±1 so a couple of clicks gets from the 7px default to something
 * readable on an A4 print (the reason this control exists); bounded by
 * LABEL_FONT_SIZE_MIN/MAX, the same range the free-text annotation picker has
 * always offered.
 */
const LABEL_SIZE_STEPS = [
  LABEL_FONT_SIZE_MIN,
  6,
  LABEL_FONT_SIZE,
  8,
  9,
  10,
  12,
  14,
  16,
  20,
  24,
  28,
  LABEL_FONT_SIZE_MAX,
] as const;

function setLabelMode(next: LabelMode): void {
  useEditorStore.getState().dispatch((d) => {
    const meta = { ...(d.meta ?? {}), labelMode: next };
    return { ...d, meta };
  });
}

/**
 * Write the document's label size. The default drops the field entirely rather
 * than storing a 7 — diagrams that never touched the setting keep serializing
 * exactly as they did before it existed.
 */
function setLabelFontSize(next: number): void {
  useEditorStore.getState().dispatch((d) => {
    const meta = { ...(d.meta ?? {}) };
    if (next === LABEL_FONT_SIZE) delete meta.labelFontSize;
    else meta.labelFontSize = next;
    return { ...d, meta };
  });
}

function stepLabelFontSize(dir: 1 | -1): void {
  const cur = resolveLabelFontSize(
    useEditorStore.getState().diagram.meta?.labelFontSize,
  );
  if (dir > 0) {
    setLabelFontSize(
      LABEL_SIZE_STEPS.find((s) => s > cur) ?? LABEL_FONT_SIZE_MAX,
    );
    return;
  }
  let next = LABEL_FONT_SIZE_MIN;
  for (let i = LABEL_SIZE_STEPS.length - 1; i >= 0; i--) {
    if (LABEL_SIZE_STEPS[i] < cur) {
      next = LABEL_SIZE_STEPS[i];
      break;
    }
  }
  setLabelFontSize(next);
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

/**
 * Label settings panel — visibility mode + type size for the whole document.
 *
 * Both live together because they answer the same question ("what do the
 * labels look like on this drawing"), and because the mode used to be a bare
 * cycling icon whose current state was only visible in a tooltip. Spelling the
 * three modes out as a segmented control makes the state legible and leaves an
 * obvious home for the size stepper users were previously faking with floating
 * text annotations.
 *
 * Rendered inline in the dense view menu and inside `LabelMenuBtn`'s popover
 * on the wide toolbar — never nested inside another popover.
 */
function LabelControls() {
  const t = useT();
  const labelMode: LabelMode = useEditorStore(
    (s) => s.diagram.meta?.labelMode ?? 'all',
  );
  const size = useEditorStore((s) =>
    resolveLabelFontSize(s.diagram.meta?.labelFontSize),
  );
  const options: { value: LabelMode; label: string }[] = [
    { value: 'off', label: t('view.labelOff') },
    { value: 'id', label: t('view.labelId') },
    { value: 'all', label: t('view.labelAll') },
  ];
  return (
    <div className="flex flex-col gap-1.5 px-1.5 py-1">
      <div className="text-[11px] font-medium text-muted-foreground">
        {t('view.label')}
      </div>
      <div className="flex overflow-hidden rounded-md border border-border/60">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={labelMode === o.value}
            onClick={() => setLabelMode(o.value)}
            className={cn(
              // No truncation: the popover is shrink-to-fit, so a long
              // translation widens the menu instead of ellipsing "ID + params".
              'h-7 flex-1 whitespace-nowrap px-1.5 text-[11px] transition-colors',
              labelMode === o.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          {t('view.labelSize')}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t('view.labelSizeSmaller')}
            disabled={size <= LABEL_FONT_SIZE_MIN}
            onClick={() => stepLabelFontSize(-1)}
            className="h-7 w-7 rounded-md border border-border/60 text-[13px] leading-none text-muted-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
          >
            −
          </button>
          <button
            type="button"
            aria-label={t('view.labelSizeReset')}
            onClick={() => setLabelFontSize(LABEL_FONT_SIZE)}
            className="w-9 rounded-md py-1 text-center font-mono text-[11px] tabular-nums hover:bg-accent hover:text-accent-foreground"
          >
            {size}
          </button>
          <button
            type="button"
            aria-label={t('view.labelSizeLarger')}
            disabled={size >= LABEL_FONT_SIZE_MAX}
            onClick={() => stepLabelFontSize(1)}
            className="h-7 w-7 rounded-md border border-border/60 text-[13px] leading-none text-muted-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

/** Popover trigger wrapping `LabelControls` for the wide (icon-row) toolbar. */
function LabelMenuBtn() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const labelMode: LabelMode = useEditorStore(
    (s) => s.diagram.meta?.labelMode ?? 'all',
  );
  return (
    <UpwardPopover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Tooltip
          content={
            <div className="space-y-0.5">
              <div className="font-medium">{t('view.label')}</div>
              <div className="text-muted-foreground">{t('view.labelHint')}</div>
            </div>
          }
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen((v) => !v)}
            aria-label={t('view.label')}
            aria-expanded={open}
            className={cn(labelMode === 'off' && 'text-muted-foreground/60')}
          >
            <Type />
          </Button>
        </Tooltip>
      }
    >
      <LabelControls />
    </UpwardPopover>
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
        </div>
        {/* Inline rather than a nested popover — this menu already opens
            upward, and a second layer on top of it would cover its own
            trigger row. */}
        <div aria-hidden className="my-1 h-px bg-border" />
        <LabelControls />
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
  const readOnly = useEditorStore((s) => s.readOnly);
  // Normally the dense+ FloatingToolbar hosts the zoom controls, so this bar
  // hides there. In read-only mode the FloatingToolbar isn't rendered, so keep
  // this bar visible at every tier to preserve on-screen zoom/fit buttons.
  if (!readOnly && atLeast(tier, 'dense')) return null;
  return <ViewToolbarExpanded tier={tier} />;
}

function ViewToolbarExpanded({ tier }: { tier: Tier }) {
  // Hide the zoom-% pill from `tight` (≥720 < 900) onward — that's where the
  // centered FloatingToolbar starts colliding with this right-anchored bar.
  const hidePercentPill = atLeast(tier, 'tight');
  const readOnly = useEditorStore((s) => s.readOnly);
  const [grid, setGrid] = useGridState();

  return (
    // z-50, not z-20: this container is its own stacking context, so the
    // Labels popover can never escape it however high the popover's own
    // z-index is. An embedding app that parks floating chrome over the
    // bottom-right corner — SmartSLD's help/feedback pills are `fixed z-40` —
    // would otherwise cover that popover and make its controls unclickable.
    // A toolbar's transient menu has to win over ambient host decoration.
    // Safe against host side panels: those are expected to move this toolbar
    // aside via `--ole-right-inset`, not to paint over it.
    <div
      className="absolute z-50"
      style={{
        bottom: 'calc(0.75rem + var(--ole-bottom-inset, 0px) + var(--ole-safe-bottom, 0px))',
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
        {/* Label settings mutate the document — omit them in view-only mode. */}
        {!readOnly && <LabelMenuBtn />}
      </div>
    </div>
  );
}
