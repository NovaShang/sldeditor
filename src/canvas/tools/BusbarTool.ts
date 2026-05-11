/**
 * Busbar tool: click-and-drag to draw a horizontal or vertical bus segment.
 *
 * Unlike the place tool (drop a fixed-size element on click), the bus needs
 * an explicit length and orientation per instance. The tool snaps the drawn
 * line to the dominant axis (horizontal or vertical) so that downstream
 * stretching, tap-routing and connectivity all stay aligned to the grid.
 *
 * Live preview: `busbarDrawStart` in the store holds the press point;
 * `cursorSvg` holds the current cursor. `BusbarPreview` reads both and
 * renders the snapped line in real time.
 *
 * UX: pointerdown sets the start; pointerup commits. Esc cancels via the
 * global keyboard hook (re-activates select).
 */

import { useEditorStore } from '../../store';
import { exitToPanIfTouch } from '../touch';
import type { Tool } from './types';

const GRID = 10;
const MIN_LEN = 20;

function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

export const BusbarTool: Tool = {
  id: 'busbar',
  cursor: 'crosshair',

  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    e.preventDefault();
    const pt = ctx.viewport.screenToSvg(e.clientX, e.clientY);
    const start: [number, number] = [snap(pt[0]), snap(pt[1])];
    useEditorStore.getState().setBusbarDrawStart(start);
    useEditorStore.getState().setCursorSvg(start);
  },

  onPointerMove(e, ctx) {
    const pt = ctx.viewport.screenToSvg(e.clientX, e.clientY);
    useEditorStore.getState().setCursorSvg([snap(pt[0]), snap(pt[1])]);
  },

  onPointerUp(e, ctx) {
    const start = useEditorStore.getState().busbarDrawStart;
    useEditorStore.getState().setBusbarDrawStart(null);
    if (!start) return;
    const pt = ctx.viewport.screenToSvg(e.clientX, e.clientY);
    const endX = snap(pt[0]);
    const endY = snap(pt[1]);
    const dx = endX - start[0];
    const dy = endY - start[1];
    const horizontal = Math.abs(dx) >= Math.abs(dy);

    let rot: 0 | 90;
    let span: number;
    let at: [number, number];

    if (horizontal) {
      span = Math.abs(dx);
      if (span < MIN_LEN) return;
      rot = 0;
      at = [(start[0] + endX) / 2, start[1]];
    } else {
      span = Math.abs(dy);
      if (span < MIN_LEN) return;
      rot = 90;
      at = [start[0], (start[1] + endY) / 2];
    }

    const store = useEditorStore.getState();
    store.addBus(at, span, rot);
    exitToPanIfTouch();
  },

  onPointerLeave() {
    const store = useEditorStore.getState();
    store.setBusbarDrawStart(null);
    store.setCursorSvg(null);
  },

  onPointerCancel() {
    // Pinch-zoom hijack interrupted the draw; abandon the in-progress busbar
    // rather than committing one at the synthetic cancel coordinates.
    const store = useEditorStore.getState();
    store.setBusbarDrawStart(null);
    store.setCursorSvg(null);
  },

  onDeactivate() {
    const store = useEditorStore.getState();
    store.setBusbarDrawStart(null);
    store.setCursorSvg(null);
  },
};
