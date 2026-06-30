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
 * The press→release resolution lives in `../wire-drag` and is shared with the
 * SelectTool's drag-a-wire-from-a-selected-terminal gesture.
 *
 * Activating the tool sets `.tool-wire` on the canvas root, which the CSS uses
 * to reveal device terminals (junctions and buses are always hittable).
 */

import { useEditorStore } from '../../store';
import {
  resolveDragTarget,
  worldTolAt,
  toWireTarget,
  sameLanding,
  elementUnder,
  type DragTarget,
} from '../wire-drag';
import { exitToPanOnPhone } from '../touch';
import { publishWireTarget } from '../wire-target-bus';
import type { Tool } from './types';

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
    const tol = worldTolAt(ctx, e.clientX, e.clientY);
    const from = resolveDragTarget(e.target instanceof Element ? e.target : null, cursor, tol);
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
    const to = resolveDragTarget(under, cursor, worldTolAt(ctx, e.clientX, e.clientY));
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
    const to = resolveDragTarget(under, cursor, worldTolAt(ctx, e.clientX, e.clientY));
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
