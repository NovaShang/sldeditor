/**
 * Fit-to-content viewport reset, shared by the explicit "fit" button in
 * ViewToolbar and the automatic reset that fires on first mount / after
 * loading a file.
 *
 * Element bboxes come from the live DOM (`data-element-id` nodes), so the
 * canvas must already have rendered the diagram. `fitToContentSoon` defers
 * via rAF until that's true (typical use: store update → next frame fit).
 */

import { getViewportApi } from './viewport-bus';

const FIT_PADDING_PX = 60;
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const READY_RETRY_FRAMES = 8;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function getCanvasRoot(): HTMLElement | null {
  return document.querySelector('.ole-canvas-root');
}

/**
 * Fit all rendered elements to the viewport with padding. Falls back to a
 * centered 100% reset when the canvas is empty. Returns false if the
 * viewport / canvas isn't ready yet.
 */
export function fitToContent(): boolean {
  const api = getViewportApi();
  const root = getCanvasRoot();
  if (!api || !root) return false;
  const rect = root.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const nodes = root.querySelectorAll('[data-element-id]');
  if (nodes.length === 0) {
    api.setViewport({ tx: rect.width / 2, ty: rect.height / 2, scale: 1 });
    return true;
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
  if (minX === Infinity) return false;
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
