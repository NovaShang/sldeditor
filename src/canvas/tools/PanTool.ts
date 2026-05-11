/**
 * Pan tool: doubles as the touch-default tool. Three gestures off a single
 * finger:
 *   - Tap on canvas      → single-select (annotation > element > wire-node)
 *                          or clearSelection on empty space.
 *   - Drag from selected → move the selected element(s) (DOM-direct preview,
 *     element              committed on pointerup via moveElements).
 *   - Drag from elsewhere → pan the viewport.
 *
 * The drag-to-move path lets a phone user reposition elements without
 * switching tools — Pan is the everything-tool on touch, similar to how a
 * map app handles pins.
 */

import type { ResolvedPlacement } from '../../compiler';
import type { ElementId } from '../../model';
import { useEditorStore } from '../../store';
import { snap } from '../grid';
import { hitAnnotation, hitElement, hitNode } from '../hit-test';
import { transformAttr } from '../transform-attr';
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
  /** If set, the gesture started on these selected elements — drag = move
   *  instead of pan. Stores each target's original placement so we can
   *  preview via DOM transform and commit a delta on pointerup. */
  elementDrag: {
    startSvg: [number, number];
    originals: Map<ElementId, ResolvedPlacement>;
  } | null;
}

let pan: PanState | null = null;

export const PanTool: Tool = {
  id: 'pan',
  cursor: 'grab',

  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    const vp = ctx.viewport.getViewport();

    // If the gesture starts on a currently-selected element, set up an
    // element drag so the same finger can move it instead of panning.
    const startId = hitElement(e.target);
    let elementDrag: PanState['elementDrag'] = null;
    if (startId) {
      const store = useEditorStore.getState();
      // If the user pressed on an unselected element, treat as a fresh
      // single-selection so the upcoming drag operates on that element.
      // The tap-without-move path also commits this selection on release.
      if (!store.selection.includes(startId)) {
        store.setSelection([startId]);
      }
      const sel = useEditorStore.getState().selection;
      const internal = useEditorStore.getState().internal;
      const originals = new Map<ElementId, ResolvedPlacement>();
      for (const id of sel) {
        const p = internal.layout.get(id);
        if (p) originals.set(id, { ...p });
      }
      if (originals.size > 0) {
        elementDrag = {
          startSvg: ctx.viewport.screenToSvg(e.clientX, e.clientY),
          originals,
        };
      }
    }

    pan = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startTx: vp.tx,
      startTy: vp.ty,
      startTarget: e.target,
      moved: false,
      elementDrag,
    };
    // Defer pointer capture until the gesture actually moves so a quick tap
    // keeps its original target for the tap-select hit-test.
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
    if (pan.elementDrag) {
      const cur = ctx.viewport.screenToSvg(e.clientX, e.clientY);
      const ddx = snap(cur[0] - pan.elementDrag.startSvg[0]);
      const ddy = snap(cur[1] - pan.elementDrag.startSvg[1]);
      for (const [id, orig] of pan.elementDrag.originals) {
        const node = ctx.hostEl.querySelector<SVGGElement>(
          `[data-element-id="${cssEscape(id)}"]`,
        );
        if (!node) continue;
        const next: ResolvedPlacement = {
          ...orig,
          at: [orig.at[0] + ddx, orig.at[1] + ddy],
        };
        node.setAttribute('transform', transformAttr(next));
      }
      return;
    }
    ctx.viewport.setViewport({ tx: pan.startTx + dx, ty: pan.startTy + dy });
  },

  onPointerUp(e, ctx) {
    if (!pan || e.pointerId !== pan.pointerId) return;
    if (ctx.hostEl.hasPointerCapture(e.pointerId)) {
      ctx.hostEl.releasePointerCapture(e.pointerId);
    }
    ctx.hostEl.style.cursor = 'grab';

    if (pan.elementDrag && pan.moved) {
      const cur = ctx.viewport.screenToSvg(e.clientX, e.clientY);
      const ddx = snap(cur[0] - pan.elementDrag.startSvg[0]);
      const ddy = snap(cur[1] - pan.elementDrag.startSvg[1]);
      if (ddx !== 0 || ddy !== 0) {
        const deltas = new Map<ElementId, [number, number]>();
        for (const id of pan.elementDrag.originals.keys()) {
          deltas.set(id, [ddx, ddy]);
        }
        useEditorStore.getState().moveElements(deltas);
      }
    } else if (!pan.moved) {
      handlePanTap(pan.startTarget);
    }
    pan = null;
  },

  onPointerCancel(_e, ctx) {
    if (pan?.elementDrag) {
      // Roll back the live preview transforms — store wasn't mutated yet.
      for (const [id, orig] of pan.elementDrag.originals) {
        const node = ctx.hostEl.querySelector<SVGGElement>(
          `[data-element-id="${cssEscape(id)}"]`,
        );
        if (node) node.setAttribute('transform', transformAttr(orig));
      }
    }
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

function cssEscape(s: string): string {
  return s.replace(/(["\\])/g, '\\$1');
}
