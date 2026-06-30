/**
 * Shared wire-drag resolution.
 *
 * Turns a press/release point into a `WireEndSpec` plus preview info. Used by
 * both the dedicated WireTool and the SelectTool's "drag a wire out of a
 * selected element's terminal" gesture, so the two behave identically: each end
 * resolves independently to an existing connectable (device pin, bus, or
 * junction), a tap onto an existing wire, or empty space — which mints a new
 * junction (a "free end"). This is the single source of truth for that logic.
 */

import { useEditorStore } from '../store';
import type { WireEndSpec } from '../store';
import type { WireEnd } from '../model';
import { hitTerminal, hitWire } from './hit-test';
import { resolveWireTarget } from './resolve-wire-target';
import type { WireTarget } from './wire-target-bus';

const GRID = 10;
const snap = (v: number): number => Math.round(v / GRID) * GRID;
/** Screen-px radius within which a release snaps onto an existing wire (taps a
 *  junction). Wider than the wire's own hit region so near-misses still land. */
export const SCREEN_TAP_TOL = 16;

/** Where a press/release at `cursor` would land, for both preview and commit. */
export interface DragTarget {
  spec: WireEndSpec;
  world: [number, number];
  ref: WireEnd | null;
  isBus: boolean;
  create: boolean;
}

/** Nearest point on a polyline to `pt` (for a clean tap onto a wire). */
function nearestOnPath(path: [number, number][], pt: [number, number]): [number, number] {
  let best: [number, number] = path[0];
  let bestD = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i];
    const [bx, by] = path[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((pt[0] - ax) * dx + (pt[1] - ay) * dy) / len2));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d = (px - pt[0]) ** 2 + (py - pt[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = [px, py];
    }
  }
  return best;
}

export function elementUnder(clientX: number, clientY: number): Element | null {
  return typeof document !== 'undefined'
    ? document.elementFromPoint(clientX, clientY)
    : null;
}

/** Nearest existing wire whose rendered path passes within `worldTol` of the
 *  cursor, with the snap point on it. Lets a tap land without pixel-precision. */
function nearestWireWithin(
  cursor: [number, number],
  worldTol: number,
): { wireId: string; at: [number, number] } | null {
  const renders = useEditorStore.getState().internal.wireRenders;
  let best: { wireId: string; at: [number, number] } | null = null;
  let bestD = worldTol;
  for (const r of renders.values()) {
    if (r.path.length < 2) continue;
    const p = nearestOnPath(r.path, cursor);
    const d = Math.hypot(p[0] - cursor[0], p[1] - cursor[1]);
    if (d <= bestD) {
      bestD = d;
      best = { wireId: r.wireId, at: p };
    }
  }
  return best;
}

/** Resolve the landing under the cursor into a spec + preview info. A release
 *  on/near an existing wire taps a junction into it; empty space drops one. */
export function resolveDragTarget(
  under: Element | null,
  cursor: [number, number],
  worldTol: number,
): DragTarget {
  const ref = under ? hitTerminal(under) : null;
  if (ref) {
    const t = resolveWireTarget(ref, cursor);
    if (t) return { spec: { end: ref }, world: t.world, ref, isBus: t.isBus, create: false };
  }
  // Tap an existing wire: prefer the exact DOM hit, else snap to the nearest
  // wire within tolerance (forgiving "drop on the line" gesture).
  let wireId = under ? hitWire(under) : null;
  let tapRaw: [number, number] | null = null;
  if (wireId) {
    const render = useEditorStore.getState().internal.wireRenders.get(wireId);
    tapRaw = render ? nearestOnPath(render.path, cursor) : cursor;
  } else {
    const near = nearestWireWithin(cursor, worldTol);
    if (near) {
      wireId = near.wireId;
      tapRaw = near.at;
    }
  }
  if (wireId && tapRaw) {
    const at: [number, number] = [snap(tapRaw[0]), snap(tapRaw[1])];
    return { spec: { onWire: wireId, at }, world: at, ref: null, isBus: false, create: true };
  }
  const at: [number, number] = [snap(cursor[0]), snap(cursor[1])];
  return { spec: { junctionAt: at }, world: at, ref: null, isBus: false, create: true };
}

/** Convert the screen-px tap tolerance to world units at the current zoom. */
export function worldTolAt(
  ctx: { viewport: { screenToSvg: (x: number, y: number) => [number, number] } },
  clientX: number,
  clientY: number,
): number {
  const a = ctx.viewport.screenToSvg(clientX, clientY);
  const b = ctx.viewport.screenToSvg(clientX + SCREEN_TAP_TOL, clientY);
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export function toWireTarget(t: DragTarget): WireTarget {
  return {
    ref: t.ref,
    world: t.world,
    isBus: t.isBus,
    ...(t.create ? { create: 'junction' as const } : {}),
  };
}

/** Same landing → the gesture is a no-op and should cancel. */
export function sameLanding(a: DragTarget, b: DragTarget): boolean {
  if (a.ref && b.ref) return a.ref === b.ref;
  if (!a.ref && !b.ref) return a.world[0] === b.world[0] && a.world[1] === b.world[1];
  return false;
}
