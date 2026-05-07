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
const ZOOM_FACTOR = 1.0015;

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
      const isZoom = e.deltaX === 0 || e.ctrlKey || e.metaKey;

      if (isZoom) {
        const k = Math.pow(ZOOM_FACTOR, -e.deltaY);
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
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    apply();

    return () => {
      host.removeEventListener('wheel', onWheel);
      host.removeEventListener('pointerdown', onPointerDown);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerup', onPointerUp);
      host.removeEventListener('pointercancel', onPointerUp);
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
