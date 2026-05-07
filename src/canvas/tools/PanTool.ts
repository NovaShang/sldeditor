/**
 * Pan tool: left-click + drag pans the viewport. Holds the same
 * grab-cursor affordance as space-hold pan from `useViewport`, but lets
 * trackpad-only users pan without holding any modifier.
 */

import type { Tool } from './types';

interface PanState {
  pointerId: number;
  startX: number;
  startY: number;
  startTx: number;
  startTy: number;
}

let pan: PanState | null = null;

export const PanTool: Tool = {
  id: 'pan',
  cursor: 'grab',

  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    const vp = ctx.viewport.getViewport();
    pan = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startTx: vp.tx,
      startTy: vp.ty,
    };
    ctx.hostEl.setPointerCapture(e.pointerId);
    ctx.hostEl.style.cursor = 'grabbing';
    e.preventDefault();
  },

  onPointerMove(e, ctx) {
    if (!pan || e.pointerId !== pan.pointerId) return;
    const dx = e.clientX - pan.startX;
    const dy = e.clientY - pan.startY;
    ctx.viewport.setViewport({ tx: pan.startTx + dx, ty: pan.startTy + dy });
  },

  onPointerUp(e, ctx) {
    if (!pan || e.pointerId !== pan.pointerId) return;
    if (ctx.hostEl.hasPointerCapture(e.pointerId)) {
      ctx.hostEl.releasePointerCapture(e.pointerId);
    }
    ctx.hostEl.style.cursor = 'grab';
    pan = null;
  },

  onDeactivate() {
    pan = null;
  },
};
