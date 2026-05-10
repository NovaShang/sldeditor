/**
 * Pan/zoom viewport. State lives on refs and is pushed straight to the SVG
 * `<g transform>` and the parent's `--canvas-scale` CSS variable; React is
 * deliberately not involved during gestures so we don't re-render on every
 * wheel tick or pointer move.
 *
 * Exposes `screenToSvg()` so future tools (select, wire, place) can convert
 * pointer events to canvas coordinates without owning their own viewport.
 */

import { useEffect, useRef, type RefObject } from 'react';
import { publishScale } from './zoom-bus';

export interface Viewport {
  tx: number;
  ty: number;
  scale: number;
}

export interface ViewportApi {
  /** Convert a clientX/Y (CSS pixels relative to the viewport) → SVG coords. */
  screenToSvg(clientX: number, clientY: number): [number, number];
  /** Read-only snapshot of the current transform. */
  getViewport(): Viewport;
  /** Update one or more viewport fields. */
  setViewport(patch: Partial<Viewport>): void;
  /** Subscribe to viewport changes; returns an unsubscribe fn. */
  subscribe(listener: (vp: Viewport) => void): () => void;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
// Mouse wheel events on macOS arrive with |deltaY| ≈ 100 per click, so a
// small factor still produces a comfortable per-click zoom. Trackpad pinch
// (Chrome/Safari synthesize wheel events with ctrlKey + small deltaY,
// typically 1–10) needs a much larger factor or it crawls vs. native apps.
const ZOOM_FACTOR_WHEEL = 1.0015;
const ZOOM_FACTOR_PINCH = 1.02;

export function useViewport(
  hostRef: RefObject<HTMLDivElement | null>,
  groupRef: RefObject<SVGGElement | null>,
  initial: Viewport = { tx: 0, ty: 0, scale: 1 },
): ViewportApi {
  const vp = useRef<Viewport>({ ...initial });
  const listeners = useRef(new Set<(vp: Viewport) => void>());

  // Apply transform on the SVG group + expose --canvas-scale for stroke
  // compensation in CSS, then notify subscribers.
  const apply = () => {
    const g = groupRef.current;
    const host = hostRef.current;
    if (g) {
      g.setAttribute(
        'transform',
        `translate(${vp.current.tx} ${vp.current.ty}) scale(${vp.current.scale})`,
      );
    }
    if (host) {
      host.style.setProperty('--canvas-scale', String(vp.current.scale));
    }
    publishScale(vp.current.scale);
    if (listeners.current.size > 0) {
      const snapshot = { ...vp.current };
      for (const fn of listeners.current) fn(snapshot);
    }
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let panning = false;
    let panPointerId = -1;
    let panStartX = 0;
    let panStartY = 0;
    let panStartTx = 0;
    let panStartTy = 0;
    let spaceDown = false;

    // ---- Multi-touch pinch / two-finger pan -----------------------------
    // iPad/iPhone have no wheel events, so pinch-zoom + two-finger pan are
    // the only way to navigate the canvas. We track every active touch
    // pointer; once two are down we hijack all touch events (capture phase
    // + stopPropagation) so the active tool stops receiving them and the
    // viewport handles pan/zoom directly. Hijack lasts until all touches
    // lift, so the trailing finger of a pinch never accidentally restarts
    // a tool gesture.
    const touches = new Map<number, { x: number; y: number }>();
    interface PinchState {
      startDist: number;
      startScale: number;
      startTx: number;
      startTy: number;
      startMidX: number;
      startMidY: number;
    }
    let pinch: PinchState | null = null;
    let touchHijack = false;

    const recomputePinchBaseline = () => {
      if (touches.size < 2) {
        pinch = null;
        return;
      }
      const pts = [...touches.values()];
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      const dist = Math.hypot(dx, dy) || 1;
      const rect = host.getBoundingClientRect();
      pinch = {
        startDist: dist,
        startScale: vp.current.scale,
        startTx: vp.current.tx,
        startTy: vp.current.ty,
        startMidX: (pts[0].x + pts[1].x) / 2 - rect.left,
        startMidY: (pts[0].y + pts[1].y) / 2 - rect.top,
      };
    };

    const onTouchPointerDownCap = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size >= 2 && !touchHijack) {
        touchHijack = true;
        // Cancel any in-progress single-touch tool gesture (drag, marquee,
        // wire, etc.) so it doesn't keep mutating state while we pinch.
        // Synthetic pointercancel fires the tool's existing cleanup path.
        for (const id of touches.keys()) {
          if (id === e.pointerId) continue;
          try {
            host.dispatchEvent(
              new PointerEvent('pointercancel', {
                pointerId: id,
                bubbles: true,
                cancelable: true,
                pointerType: 'touch',
              }),
            );
          } catch {
            /* synthetic event constructor unsupported — best-effort only */
          }
        }
        recomputePinchBaseline();
      }
      if (touchHijack) {
        e.stopPropagation();
        e.preventDefault();
        try {
          host.setPointerCapture(e.pointerId);
        } catch {
          /* capture may fail if the pointer was already released */
        }
      }
    };

    const onTouchPointerMoveCap = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!touchHijack || !pinch) return;
      e.stopPropagation();
      const pts = [...touches.values()];
      if (pts.length < 2) return;
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      const dist = Math.hypot(dx, dy) || 1;
      const rect = host.getBoundingClientRect();
      const midX = (pts[0].x + pts[1].x) / 2 - rect.left;
      const midY = (pts[0].y + pts[1].y) / 2 - rect.top;
      const ratio = dist / pinch.startDist;
      const next = clamp(pinch.startScale * ratio, MIN_SCALE, MAX_SCALE);
      const k = next / pinch.startScale;
      // Anchor zoom at the initial midpoint, then add the midpoint drift
      // so the pinch also pans.
      vp.current.tx =
        pinch.startMidX - (pinch.startMidX - pinch.startTx) * k + (midX - pinch.startMidX);
      vp.current.ty =
        pinch.startMidY - (pinch.startMidY - pinch.startTy) * k + (midY - pinch.startMidY);
      vp.current.scale = next;
      apply();
    };

    const onTouchPointerUpCap = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      if (!touches.has(e.pointerId)) return;
      touches.delete(e.pointerId);
      if (touchHijack) {
        e.stopPropagation();
        if (host.hasPointerCapture?.(e.pointerId)) {
          try {
            host.releasePointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
        }
        // If a finger lifted but more than one is still down, recompute
        // the pinch baseline so the next move continues smoothly.
        if (touches.size >= 2) {
          recomputePinchBaseline();
        } else {
          pinch = null;
        }
        if (touches.size === 0) {
          touchHijack = false;
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = host.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      // CAD-style: any pure-vertical wheel event zooms (mouse wheel on macOS
      // can have |deltaY| < 30 — earlier threshold-based heuristic let those
      // slip into the pan branch, producing a "wobble" during zoom).
      // Pinch (ctrl/meta) zooms regardless of axis. Only deltaX-bearing
      // events without a modifier are treated as trackpad pan.
      const isPinch = e.ctrlKey || e.metaKey;
      const isZoom = e.deltaX === 0 || isPinch;

      if (isZoom) {
        const factor = isPinch ? ZOOM_FACTOR_PINCH : ZOOM_FACTOR_WHEEL;
        const k = Math.pow(factor, -e.deltaY);
        const next = clamp(vp.current.scale * k, MIN_SCALE, MAX_SCALE);
        // Keep cursor anchored.
        const ratio = next / vp.current.scale;
        vp.current.tx = cx - (cx - vp.current.tx) * ratio;
        vp.current.ty = cy - (cy - vp.current.ty) * ratio;
        vp.current.scale = next;
      } else {
        vp.current.tx -= e.deltaX;
        vp.current.ty -= e.deltaY;
      }
      apply();
    };

    const onPointerDown = (e: PointerEvent) => {
      // Middle-click pan, or space-held + left-click pan.
      const isMiddle = e.button === 1;
      const isSpaceLeft = spaceDown && e.button === 0;
      if (!isMiddle && !isSpaceLeft) return;
      e.preventDefault();
      panning = true;
      panPointerId = e.pointerId;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panStartTx = vp.current.tx;
      panStartTy = vp.current.ty;
      host.setPointerCapture(e.pointerId);
      host.style.cursor = 'grabbing';
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!panning || e.pointerId !== panPointerId) return;
      vp.current.tx = panStartTx + (e.clientX - panStartX);
      vp.current.ty = panStartTy + (e.clientY - panStartY);
      apply();
    };
    const onPointerUp = (e: PointerEvent) => {
      if (panning && e.pointerId === panPointerId) {
        panning = false;
        host.releasePointerCapture(e.pointerId);
        host.style.cursor = spaceDown ? 'grab' : '';
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !spaceDown) {
        // Don't hijack typing into a future input element.
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
        spaceDown = true;
        host.style.cursor = 'grab';
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDown = false;
        if (!panning) host.style.cursor = '';
      }
    };

    host.addEventListener('wheel', onWheel, { passive: false });
    host.addEventListener('pointerdown', onPointerDown);
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerup', onPointerUp);
    host.addEventListener('pointercancel', onPointerUp);
    // Touch handlers run in the capture phase so they can stopPropagation()
    // and prevent the active tool from receiving the events while pinch is
    // in progress.
    host.addEventListener('pointerdown', onTouchPointerDownCap, { capture: true });
    host.addEventListener('pointermove', onTouchPointerMoveCap, { capture: true });
    host.addEventListener('pointerup', onTouchPointerUpCap, { capture: true });
    host.addEventListener('pointercancel', onTouchPointerUpCap, { capture: true });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    apply();

    return () => {
      host.removeEventListener('wheel', onWheel);
      host.removeEventListener('pointerdown', onPointerDown);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerup', onPointerUp);
      host.removeEventListener('pointercancel', onPointerUp);
      host.removeEventListener('pointerdown', onTouchPointerDownCap, { capture: true });
      host.removeEventListener('pointermove', onTouchPointerMoveCap, { capture: true });
      host.removeEventListener('pointerup', onTouchPointerUpCap, { capture: true });
      host.removeEventListener('pointercancel', onTouchPointerUpCap, { capture: true });
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    screenToSvg(clientX: number, clientY: number) {
      const host = hostRef.current;
      if (!host) return [clientX, clientY];
      const rect = host.getBoundingClientRect();
      const x = (clientX - rect.left - vp.current.tx) / vp.current.scale;
      const y = (clientY - rect.top - vp.current.ty) / vp.current.scale;
      return [x, y];
    },
    getViewport() {
      return { ...vp.current };
    },
    setViewport(patch: Partial<Viewport>) {
      if (patch.tx !== undefined) vp.current.tx = patch.tx;
      if (patch.ty !== undefined) vp.current.ty = patch.ty;
      if (patch.scale !== undefined)
        vp.current.scale = clamp(patch.scale, MIN_SCALE, MAX_SCALE);
      apply();
    },
    subscribe(listener) {
      listeners.current.add(listener);
      return () => {
        listeners.current.delete(listener);
      };
    },
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
