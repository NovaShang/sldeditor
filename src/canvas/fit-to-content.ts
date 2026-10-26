/**
 * Fit-to-content viewport reset, shared by the explicit "fit" button in
 * ViewToolbar and the automatic reset that fires on first mount / after
 * loading a file.
 *
 * Bounds come from the live DOM — every node matching `FIT_CONTENT_SELECTOR`
 * — so the canvas must already have rendered the diagram. `fitToContentSoon`
 * defers via rAF until that's true (typical use: store update → next frame
 * fit).
 */

import { getViewportApi } from './viewport-bus';
import type { ViewportApi } from './useViewport';

const FIT_PADDING_PX = 60;
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const READY_RETRY_FRAMES = 8;

/**
 * Everything that is *drawn*, as opposed to editor chrome (selection halos,
 * handles, previews, ghosts): devices, buses, junctions and terminals (all
 * tagged `data-element-id`), wires, element label blocks, wire labels and
 * free annotations (title blocks, frames, legends, tables).
 *
 * The fit used to match `[data-element-id]` alone, so a drawing whose
 * annotations reach far past its devices was framed at a fraction of its
 * extent — and the canvas disagreed with the export frame, which has always
 * counted labels and annotations (`computeContentBbox` in export-image.ts).
 * A layer that adds a new kind of drawn object must tag it with one of these
 * attributes (or extend this list) for Fit view to see it.
 *
 * Drawing sheets count too: a fit that crops the frame shows a page with its
 * title block cut off. Their `[data-sheet-id]` group holds the paper-sized
 * border plus hit shapes of the same geometry (the border grab band is a
 * few screen px of stroke at most, even in a browser whose client rects
 * count strokes), so it measures the paper, not a padded hit box.
 */
export const FIT_CONTENT_SELECTOR = [
  '[data-element-id]',
  '[data-wire-id]',
  '[data-element-label]',
  '[data-wire-label]',
  '[data-annotation-id]',
  '[data-sheet-id]',
].join(', ');

export interface ScreenBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Union of client rects, skipping degenerate (0×0) ones — unmeasured or
 * empty nodes. A horizontal wire is 0 tall but still counts. Null when
 * nothing measurable remains.
 */
export function unionRects(
  rects: Iterable<Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>>,
): ScreenBounds | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    if (r.width === 0 && r.height === 0) continue;
    if (r.left < left) left = r.left;
    if (r.top < top) top = r.top;
    if (r.right > right) right = r.right;
    if (r.bottom > bottom) bottom = r.bottom;
  }
  return left === Infinity ? null : { left, top, right, bottom };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function getCanvasRoot(): HTMLElement | null {
  return document.querySelector('.ole-canvas-root');
}

/**
 * The horizontal span of the canvas that is not covered by a docked panel
 * (anything tagged `data-ole-occludes`, e.g. the open checks panel), in
 * canvas-local px. A panel counts against the side it sits on, so fitting or
 * jumping to an element never parks it underneath the list the user is
 * reading.
 */
function visibleSpan(rect: DOMRect): { x0: number; x1: number } {
  let left = rect.left;
  let right = rect.right;
  const mid = rect.left + rect.width / 2;
  for (const el of document.querySelectorAll('[data-ole-occludes]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.bottom < rect.top || r.top > rect.bottom) continue;
    if (r.left > mid) right = Math.min(right, r.left);
    else if (r.right < mid) left = Math.max(left, r.right);
  }
  // A panel wider than half the canvas (small windows): ignore it rather
  // than squeeze the drawing into a sliver.
  if (right - left < rect.width / 2) return { x0: 0, x1: rect.width };
  return { x0: left - rect.left, x1: right - rect.left };
}

/**
 * Fit the whole rendered drawing to the viewport with padding. Falls back to a
 * centered 100% reset when the canvas is empty. Returns false if the
 * viewport / canvas isn't ready yet.
 */
export function fitToContent(): boolean {
  const api = getViewportApi();
  const root = getCanvasRoot();
  if (!api || !root) return false;
  return fitToContentWith(api, root);
}

/**
 * The fit itself, against an explicit viewport + canvas root. `fitToContent`
 * above resolves both from the editor's module-level singletons; the viewer
 * owns its own pair (several viewers may share a page) and calls this.
 */
export function fitToContentWith(api: ViewportApi, root: HTMLElement): boolean {
  const rect = root.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const nodes = root.querySelectorAll(FIT_CONTENT_SELECTOR);
  if (nodes.length === 0) {
    api.setViewport({ tx: rect.width / 2, ty: rect.height / 2, scale: 1 });
    return true;
  }
  const bounds = unionRects(
    Array.from(nodes, (n) => n.getBoundingClientRect()),
  );
  if (!bounds) return false;
  const { left: minX, top: minY, right: maxX, bottom: maxY } = bounds;
  const [ax, ay] = api.screenToSvg(minX, minY);
  const [bx, by] = api.screenToSvg(maxX, maxY);
  const contentW = Math.max(bx - ax, 1);
  const contentH = Math.max(by - ay, 1);
  const { x0, x1 } = visibleSpan(rect);
  const targetScale = clamp(
    Math.min(
      (x1 - x0 - FIT_PADDING_PX * 2) / contentW,
      (rect.height - FIT_PADDING_PX * 2) / contentH,
    ),
    MIN_SCALE,
    MAX_SCALE,
  );
  const cx = (ax + bx) / 2;
  const cy = (ay + by) / 2;
  api.setViewport({
    tx: (x0 + x1) / 2 - targetScale * cx,
    ty: rect.height / 2 - targetScale * cy,
    scale: targetScale,
  });
  return true;
}

/**
 * Pan so a world point sits in the middle of the viewport, keeping the zoom.
 * Used to jump to an off-page connector's partner. Returns false when the
 * viewport isn't mounted.
 */
export function centerOnWorld(world: readonly [number, number]): boolean {
  const api = getViewportApi();
  const root = getCanvasRoot();
  if (!api || !root) return false;
  const rect = root.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const { scale } = api.getViewport();
  const { x0, x1 } = visibleSpan(rect);
  api.setViewport({
    tx: (x0 + x1) / 2 - scale * world[0],
    ty: rect.height / 2 - scale * world[1],
  });
  return true;
}

/**
 * Run `fitToContent` after the next paint, retrying for a few frames in case
 * the canvas hasn't mounted yet (initial mount race) or the diagram has
 * just been swapped and the new DOM nodes aren't yet attached.
 */
export function fitToContentSoon(): void {
  let frames = READY_RETRY_FRAMES;
  const tick = () => {
    if (fitToContent()) return;
    if (--frames > 0) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * Fit a world rectangle (e.g. one drawing sheet) into the visible part of the
 * canvas with padding, leaving room for docked panels like `fitToContent`.
 * Returns false when the viewport isn't mounted.
 */
export function fitToWorldRect(rect: { x: number; y: number; w: number; h: number }): boolean {
  const api = getViewportApi();
  const root = getCanvasRoot();
  if (!api || !root) return false;
  const box = root.getBoundingClientRect();
  if (box.width === 0 || box.height === 0 || rect.w <= 0 || rect.h <= 0) return false;
  const { x0, x1 } = visibleSpan(box);
  const scale = clamp(
    Math.min((x1 - x0 - FIT_PADDING_PX * 2) / rect.w, (box.height - FIT_PADDING_PX * 2) / rect.h),
    MIN_SCALE,
    MAX_SCALE,
  );
  api.setViewport({
    tx: (x0 + x1) / 2 - scale * (rect.x + rect.w / 2),
    ty: box.height / 2 - scale * (rect.y + rect.h / 2),
    scale,
  });
  return true;
}
