/**
 * Place tool: click anywhere on canvas to drop the chosen kind. The kind is
 * picked from the palette (LeftPanel single-click) or set programmatically
 * via `setActiveTool('place', { placeKind })`.
 *
 * Stays in place mode after dropping so the user can drop multiples; press
 * Esc or switch tools to leave.
 */

import { useEditorStore } from '@/store';
import { dropElement } from '../drop-on-bus';
import type { Tool } from './types';

const GRID = 10;

export const PlaceTool: Tool = {
  id: 'place',
  cursor: 'copy',

  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    const { placeKind } = useEditorStore.getState();
    if (!placeKind) return;
    e.preventDefault();
    const pt = ctx.viewport.screenToSvg(e.clientX, e.clientY);
    dropElement(placeKind, pt);
  },

  onPointerMove(e, ctx) {
    const pt = ctx.viewport.screenToSvg(e.clientX, e.clientY);
    useEditorStore.getState().setCursorSvg([snap(pt[0]), snap(pt[1])]);
  },

  onPointerLeave() {
    useEditorStore.getState().setCursorSvg(null);
  },

  onDeactivate() {
    useEditorStore.getState().setCursorSvg(null);
  },
};

function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}
