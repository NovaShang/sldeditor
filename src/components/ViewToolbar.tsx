import { useEffect, useState } from 'react';
import { Grid2x2, Maximize2, Minus, Plus } from 'lucide-react';
import { Button } from './ui/button';
import { Tooltip } from './ui/tooltip';
import { getViewportApi, getScale, subscribeScale } from '../canvas';
import { useT } from '../i18n';
import { cn } from '../lib/utils';

const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8] as const;
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const FIT_PADDING_PX = 60;

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
 * Fit all rendered elements to the viewport with padding. Falls back to
 * a centered 100% reset when the canvas is empty.
 */
function fitToContent(): void {
  const api = getViewportApi();
  const root = getCanvasRoot();
  if (!api || !root) return;
  const nodes = root.querySelectorAll('[data-element-id]');
  const rect = root.getBoundingClientRect();
  if (nodes.length === 0) {
    api.setViewport({ tx: rect.width / 2, ty: rect.height / 2, scale: 1 });
    return;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const r = (n as Element).getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.left < minX) minX = r.left;
    if (r.top < minY) minY = r.top;
    if (r.right > maxX) maxX = r.right;
    if (r.bottom > maxY) maxY = r.bottom;
  }
  if (minX === Infinity) return;
  // Convert screen-bbox corners to current SVG coords; that bbox is what we
  // want to fit to the host minus padding.
  const [ax, ay] = api.screenToSvg(minX, minY);
  const [bx, by] = api.screenToSvg(maxX, maxY);
  const contentW = Math.max(bx - ax, 1);
  const contentH = Math.max(by - ay, 1);
  const targetScale = clamp(
    Math.min(
      (rect.width - FIT_PADDING_PX * 2) / contentW,
      (rect.height - FIT_PADDING_PX * 2) / contentH,
    ),
    MIN_SCALE,
    MAX_SCALE,
  );
  const cx = (ax + bx) / 2;
  const cy = (ay + by) / 2;
  api.setViewport({
    tx: rect.width / 2 - targetScale * cx,
    ty: rect.height / 2 - targetScale * cy,
    scale: targetScale,
  });
}

export function ViewToolbar() {
  const t = useT();
  const [scale, setScale] = useState(getScale);
  const [grid, setGrid] = useState<boolean>(() => readGrid());

  useEffect(() => subscribeScale(setScale), []);

  useEffect(() => {
    const root = getCanvasRoot();
    root?.classList.toggle('hide-grid', !grid);
    writeGrid(grid);
  }, [grid]);

  // Keyboard: G toggles grid (ignoring when typing into inputs).
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

  return (
    <div className="absolute bottom-3 right-3 z-20">
      <div className="ole-glass flex items-center gap-0.5 rounded-2xl border border-border p-1.5 shadow-sm">
        <Tooltip
          content={
            <div className="space-y-0.5">
              <div className="font-medium">{t('view.zoomOut')}</div>
              <div className="text-muted-foreground">
                {t('view.zoomOutHint')}
              </div>
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
        <Tooltip
          content={
            <div className="space-y-0.5">
              <div className="font-medium">{t('view.zoomIn')}</div>
              <div className="text-muted-foreground">
                {t('view.zoomInHint')}
              </div>
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
        <div aria-hidden className="mx-1 h-4 w-px bg-border" />
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
      </div>
    </div>
  );
}
