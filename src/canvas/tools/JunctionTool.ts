/**
 * Junction tool: click to drop a free-standing junction (point connection
 * node) at the snapped cursor. Wires can then attach to it — but most
 * junctions are created implicitly by the wire tool dragging into empty space;
 * this tool is for placing one deliberately ahead of wiring.
 */

import { useEditorStore } from '../../store';
import { exitToPanOnPhone } from '../touch';
import type { Tool } from './types';

const GRID = 10;
const snap = (v: number): number => Math.round(v / GRID) * GRID;

export const JunctionTool: Tool = {
  id: 'junction',
  cursor: 'crosshair',

  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const pt = ctx.viewport.screenToSvg(e.clientX, e.clientY);
    useEditorStore.getState().addJunction([snap(pt[0]), snap(pt[1])]);
    exitToPanOnPhone();
  },
};
