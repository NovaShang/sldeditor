import { useEffect, useState } from 'react';
import { Grid2x2, Maximize2, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { getViewportApi, getScale, subscribeScale } from '@/canvas';
import { cn } from '@/lib/utils';

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
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
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
              <div className="font-medium">缩小</div>
              <div className="text-muted-foreground">
                按预设档位缩小；也可滚轮 ↓ 或 ⌘−
              </div>
            </div>
          }
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={zoomOut}
            aria-label="缩小"
          >
            <Minus />
          </Button>
        </Tooltip>
        <Tooltip
          content={
            <div className="space-y-0.5">
              <div className="font-medium">重置到 100%</div>
              <div className="text-muted-foreground">
                当前 {Math.round(scale * 100)}% — 点击恢复 1:1
              </div>
            </div>
          }
        >
          <button
            type="button"
            onClick={() => zoomTo(1)}
            className="min-w-12 rounded-md px-2 py-1 text-center text-xs tabular-nums text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            aria-label="重置到 100%"
          >
            {Math.round(scale * 100)}%
          </button>
        </Tooltip>
        <Tooltip
          content={
            <div className="space-y-0.5">
              <div className="font-medium">放大</div>
              <div className="text-muted-foreground">
                按预设档位放大；也可滚轮 ↑ 或 ⌘+
              </div>
            </div>
          }
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={zoomIn}
            aria-label="放大"
          >
            <Plus />
          </Button>
        </Tooltip>
        <div aria-hidden className="mx-1 h-4 w-px bg-border" />
        <Tooltip
          content={
            <div className="space-y-0.5">
              <div className="font-medium">适配视图</div>
              <div className="text-muted-foreground">
                自动缩放并居中所有元件
              </div>
            </div>
          }
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={fitToContent}
            aria-label="适配视图"
          >
            <Maximize2 />
          </Button>
        </Tooltip>
        <Tooltip
          content={
            <div className="space-y-0.5">
              <div>
                <span className="font-medium">
                  {grid ? '隐藏网格' : '显示网格'}
                </span>
                <span className="ml-1.5 text-muted-foreground">G</span>
              </div>
              <div className="text-muted-foreground">
                {grid
                  ? '同时关闭对齐吸附（拖动可自由放置）'
                  : '同时开启对齐吸附（拖动会贴到 10px 网格）'}
              </div>
            </div>
          }
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setGrid((v) => !v)}
            aria-label={grid ? '隐藏网格并关闭吸附' : '显示网格并开启吸附'}
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
