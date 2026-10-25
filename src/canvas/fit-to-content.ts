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
 */
export const FIT_CONTENT_SELECTOR = [
  '[data-element-id]',
  '[data-wire-id]',
  '[data-element-label]',
  '[data-wire-label]',
  '[data-annotation-id]',
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
  api.setViewport({
    tx: rect.width / 2 - scale * world[0],
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
