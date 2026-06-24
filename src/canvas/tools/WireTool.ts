/**
 * Wire tool — draw a wire freely.
 *
 * Press and drag to a release point. Each end resolves independently to:
 *   - an existing connectable (device pin, bus body, or junction), or
 *   - empty space → a new junction is minted at the snapped cursor, or
 *   - an existing wire body → that wire is split and a junction tapped in.
 *
 * So a wire no longer needs two pre-existing anchors: clicking into space drops
 * a junction and wires to it. The whole gesture commits in one `connectWire`
 * dispatch = one undo entry. Releasing on the same landing point cancels.
 *
 * Activating the tool sets `.tool-wire` on the canvas root, which the CSS uses
 * to reveal device terminals (junctions and buses are always hittable).
 */

import { useEditorStore } from '../../store';
import type { WireEndSpec } from '../../store';
import type { WireEnd } from '../../model';
import { hitTerminal, hitWire } from '../hit-test';
import { resolveWireTarget } from '../resolve-wire-target';
import { exitToPanOnPhone } from '../touch';
import { publishWireTarget, type WireTarget } from '../wire-target-bus';
import type { Tool } from './types';

const GRID = 10;
const snap = (v: number): number => Math.round(v / GRID) * GRID;

/** Where a press/release at `cursor` would land, for both preview and commit. */
interface DragTarget {
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

function elementUnder(clientX: number, clientY: number): Element | null {
  return typeof document !== 'undefined'
    ? document.elementFromPoint(clientX, clientY)
    : null;
}

/** Resolve the landing under the cursor into a spec + preview info. */
function resolveDragTarget(under: Element | null, cursor: [number, number]): DragTarget {
  const ref = under ? hitTerminal(under) : null;
  if (ref) {
    const t = resolveWireTarget(ref, cursor);
    if (t) return { spec: { end: ref }, world: t.world, ref, isBus: t.isBus, create: false };
  }
  const wireId = under ? hitWire(under) : null;
  if (wireId) {
    const render = useEditorStore.getState().internal.wireRenders.get(wireId);
    const raw = render ? nearestOnPath(render.path, cursor) : cursor;
    const at: [number, number] = [snap(raw[0]), snap(raw[1])];
    return { spec: { onWire: wireId, at }, world: at, ref: null, isBus: false, create: true };
  }
  const at: [number, number] = [snap(cursor[0]), snap(cursor[1])];
  return { spec: { junctionAt: at }, world: at, ref: null, isBus: false, create: true };
}

function toWireTarget(t: DragTarget): WireTarget {
  return {
    ref: t.ref,
    world: t.world,
    isBus: t.isBus,
    ...(t.create ? { create: 'junction' as const } : {}),
  };
}

/** Same landing → the gesture is a no-op and should cancel. */
function sameLanding(a: DragTarget, b: DragTarget): boolean {
  if (a.ref && b.ref) return a.ref === b.ref;
  if (!a.ref && !b.ref) return a.world[0] === b.world[0] && a.world[1] === b.world[1];
  return false;
}

export const WireTool: Tool = {
  id: 'wire',
  cursor: 'crosshair',

  onActivate(ctx) {
    ctx.hostEl.classList.add('tool-wire');
  },
  onDeactivate(ctx) {
    ctx.hostEl.classList.remove('tool-wire');
    const store = useEditorStore.getState();
    store.setWireFromTerminal(null);
    store.setWireDragFrom(null);
    store.setCursorSvg(null);
    publishWireTarget(null);
  },

  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    // Touch pointers get implicit capture on pointerdown — release it so the
    // pointerup hit-test resolves to what's under the finger, not the origin.
    if (e.target instanceof Element && e.target.hasPointerCapture?.(e.pointerId)) {
      e.target.releasePointerCapture(e.pointerId);
    }

    const cursor = ctx.viewport.screenToSvg(e.clientX, e.clientY);
    const from = resolveDragTarget(e.target instanceof Element ? e.target : null, cursor);
    const store = useEditorStore.getState();
    store.setWireDragFrom({ spec: from.spec, world: from.world, ref: from.ref });
    store.setWireFromTerminal(from.ref);
    store.setCursorSvg(cursor);
  },

  onPointerMove(e, ctx) {
    const store = useEditorStore.getState();
    const from = store.wireDragFrom;
    if (!from) return;
    const cursor = ctx.viewport.screenToSvg(e.clientX, e.clientY);
    store.setCursorSvg(cursor);

    // Pointer capture pins `e.target` to the origin — sample what's actually
    // under the cursor instead.
    const under = elementUnder(e.clientX, e.clientY);
    const to = resolveDragTarget(under, cursor);
    const fromTarget: DragTarget = {
      spec: from.spec,
      world: from.world,
      ref: from.ref,
      isBus: false,
      create: !from.ref,
    };
    publishWireTarget(sameLanding(fromTarget, to) ? null : toWireTarget(to));
  },

  onPointerUp(e, ctx) {
    const store = useEditorStore.getState();
    const from = store.wireDragFrom;
    store.setWireFromTerminal(null);
    store.setWireDragFrom(null);
    store.setCursorSvg(null);
    publishWireTarget(null);
    if (!from) return;

    const cursor = ctx.viewport.screenToSvg(e.clientX, e.clientY);
    const under = elementUnder(e.clientX, e.clientY) ?? (e.target instanceof Element ? e.target : null);
    const to = resolveDragTarget(under, cursor);
    const fromTarget: DragTarget = {
      spec: from.spec,
      world: from.world,
      ref: from.ref,
      isBus: false,
      create: !from.ref,
    };
    if (sameLanding(fromTarget, to)) return;
    store.connectWire(from.spec, to.spec);
    exitToPanOnPhone();
  },

  onPointerLeave() {
    const store = useEditorStore.getState();
    store.setWireFromTerminal(null);
    store.setWireDragFrom(null);
    store.setCursorSvg(null);
    publishWireTarget(null);
  },
};
