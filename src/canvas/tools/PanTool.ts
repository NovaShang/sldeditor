/**
 * Pan tool: left-click + drag pans the viewport. Holds the same
 * grab-cursor affordance as space-hold pan from `useViewport`, but lets
 * trackpad-only users pan without holding any modifier.
 *
 * A pointerup with no significant movement is treated as a tap: the original
 * pointer target gets the same single-selection treatment SelectTool would
 * apply on click (annotation > element > wire-node > clear). This makes pan
 * the natural default tool on touch where one finger has to handle both
 * panning and tapping to select.
 */

import { useEditorStore } from '../../store';
import { hitAnnotation, hitElement, hitNode } from '../hit-test';
import type { Tool } from './types';

const TAP_THRESHOLD_PX = 4;

interface PanState {
  pointerId: number;
  startX: number;
  startY: number;
  startTx: number;
  startTy: number;
  startTarget: EventTarget | null;
  moved: boolean;
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
      startTarget: e.target,
      moved: false,
    };
    // Defer pointer capture until the gesture actually starts panning; with
    // an early capture, a quick tap would re-target pointerup to the host
    // and we'd lose the original element under the finger.
    ctx.hostEl.style.cursor = 'grabbing';
    e.preventDefault();
  },

  onPointerMove(e, ctx) {
    if (!pan || e.pointerId !== pan.pointerId) return;
    const dx = e.clientX - pan.startX;
    const dy = e.clientY - pan.startY;
    if (!pan.moved && Math.hypot(dx, dy) > TAP_THRESHOLD_PX) {
      pan.moved = true;
      try {
        ctx.hostEl.setPointerCapture(e.pointerId);
      } catch {
        /* pointer may already be released */
      }
    }
    if (!pan.moved) return;
    ctx.viewport.setViewport({ tx: pan.startTx + dx, ty: pan.startTy + dy });
  },

  onPointerUp(e, ctx) {
    if (!pan || e.pointerId !== pan.pointerId) return;
    if (ctx.hostEl.hasPointerCapture(e.pointerId)) {
      ctx.hostEl.releasePointerCapture(e.pointerId);
    }
    ctx.hostEl.style.cursor = 'grab';
    if (!pan.moved) handlePanTap(pan.startTarget);
    pan = null;
  },

  onPointerCancel() {
    pan = null;
  },

  onDeactivate() {
    pan = null;
  },
};

function handlePanTap(target: EventTarget | null) {
  if (!target) return;
  const store = useEditorStore.getState();
  const annId = hitAnnotation(target);
  if (annId) {
    store.setSelectedAnnotation(annId);
    return;
  }
  const id = hitElement(target);
  if (id) {
    store.setSelection([id]);
    return;
  }
  const nodeId = hitNode(target);
  if (nodeId) {
    store.setSelectedNode(nodeId);
    return;
  }
  store.clearSelection();
}
