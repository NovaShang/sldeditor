/**
 * Place tool: click anywhere on canvas to drop the chosen kind. The kind is
 * picked from the palette (LeftPanel single-click) or set programmatically
 * via `setActiveTool('place', { placeKind })`.
 *
 * Two interaction paths:
 *   1. Press on empty space (or near a bus body) → drops at cursor; near-bus
 *      auto-tap via `dropElement`.
 *   2. Press on an existing terminal (incl. busbar virtual `tap`) → drag-place.
 *      Ghost follows the cursor with a dashed wire previewing the connection
 *      back to the source terminal. On release we create the element and add
 *      the connection in a single undo step via `dropElementFromTerminal`.
 *
 * Activating the tool sets `.tool-place` on the canvas root, which the CSS
 * uses to reveal terminals so users can see drag-from targets.
 *
 * Stays in place mode after dropping so the user can drop multiples; press
 * Esc or switch tools to leave.
 */

import { useEditorStore } from '../../store';
import { dropElement, dropElementFromTerminal } from '../drop-on-bus';
import { hitTerminal } from '../hit-test';
import type { Tool } from './types';

const GRID = 10;

export const PlaceTool: Tool = {
  id: 'place',
  cursor: 'copy',

  onActivate(ctx) {
    ctx.hostEl.classList.add('tool-place');
  },
  onDeactivate(ctx) {
    ctx.hostEl.classList.remove('tool-place');
    const store = useEditorStore.getState();
    store.setPlaceFromTerminal(null);
    store.setCursorSvg(null);
  },

  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    const { placeKind } = useEditorStore.getState();
    if (!placeKind) return;
    e.preventDefault();

    const ref = hitTerminal(e.target);
    if (ref) {
      // Drag-from-terminal mode: defer creation until pointerup so the user
      // can cancel by releasing outside or pressing Esc.
      e.stopPropagation();

      // Touch pointers get implicit capture on pointerdown — release it so
      // pointermove/up reflect the actual cursor target, mirroring WireTool.
      if (e.target instanceof Element && e.target.hasPointerCapture?.(e.pointerId)) {
        e.target.releasePointerCapture(e.pointerId);
      }

      const store = useEditorStore.getState();
      store.setPlaceFromTerminal(ref);
      store.setCursorSvg(ctx.viewport.screenToSvg(e.clientX, e.clientY));
      return;
    }

    const pt = ctx.viewport.screenToSvg(e.clientX, e.clientY);
    dropElement(placeKind, pt);
  },

  onPointerMove(e, ctx) {
    const pt = ctx.viewport.screenToSvg(e.clientX, e.clientY);
    useEditorStore.getState().setCursorSvg([snap(pt[0]), snap(pt[1])]);
  },

  onPointerUp(e, ctx) {
    const store = useEditorStore.getState();
    const from = store.placeFromTerminal;
    if (!from) return;
    store.setPlaceFromTerminal(null);
    const { placeKind } = store;
    if (!placeKind) return;
    const pt = ctx.viewport.screenToSvg(e.clientX, e.clientY);
    dropElementFromTerminal(placeKind, from, pt);
  },

  onPointerLeave() {
    const store = useEditorStore.getState();
    store.setPlaceFromTerminal(null);
    store.setCursorSvg(null);
  },
};

function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}
