/**
 * Select tool: click to select, shift-click to add/remove from selection,
 * drag a selected element (or one just clicked) to move all selected
 * elements together. Drag in *empty space* draws a marquee box and selects
 * every element whose bbox intersects the box (replace, or add with shift).
 *
 * Movement uses DOM-direct mutation (`setAttribute('transform')`) during
 * the drag and dispatches a single `moveElements` action on pointer-up.
 * This keeps the drag at 60fps even for diagrams that would otherwise
 * recompile on every pointermove.
 */

import { useEditorStore } from '@/store';
import type { ResolvedPlacement } from '@/compiler';
import type { ElementId } from '@/model';
import { libraryById } from '@/element-library';
import { snap } from '../grid';
import { hitElement, hitNode } from '../hit-test';
import { publishMarquee, type MarqueeRect } from '../marquee-bus';
import { transformAttr } from '../transform-attr';
import type { Tool } from './types';

const MARQUEE_THRESHOLD = 3;

interface DragState {
  pointerId: number;
  startSvg: [number, number];
  /** Original placements of every dragged element. */
  originals: Map<ElementId, ResolvedPlacement>;
  moved: boolean;
}

interface MarqueeState {
  pointerId: number;
  startSvg: [number, number];
  shiftKey: boolean;
  /** Selection at gesture start; used as the base when shift-extending. */
  baseSelection: ElementId[];
}

let drag: DragState | null = null;
let marquee: MarqueeState | null = null;

export const SelectTool: Tool = {
  id: 'select',
  cursor: 'default',

  onPointerDown(e, ctx) {
    if (e.button !== 0) return; // ignore middle/right

    // Bus stretch handles are *inside* the canvas host but their React
    // handlers run after the host's native bubble phase (React 17+ root
    // delegation). Ignoring handle hits here keeps SelectTool from
    // clearing the very selection that owns those handles.
    if (
      e.target instanceof Element &&
      e.target.closest('.ole-bus-handle')
    ) {
      return;
    }

    const id = hitElement(e.target);
    const store = useEditorStore.getState();

    if (!id) {
      // Click on a wire → select its ConnectivityNode (no marquee, no
      // element selection change beyond the implicit clear).
      const nodeId = hitNode(e.target);
      if (nodeId) {
        e.preventDefault();
        store.setSelectedNode(nodeId);
        return;
      }

      // Empty-space click → start marquee. The selection only changes on
      // pointerup; leaves selection unchanged for plain shift+drag.
      if (!e.shiftKey) store.clearSelection();
      marquee = {
        pointerId: e.pointerId,
        startSvg: ctx.viewport.screenToSvg(e.clientX, e.clientY),
        shiftKey: e.shiftKey,
        baseSelection: e.shiftKey ? store.selection.slice() : [],
      };
      ctx.hostEl.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    // Update selection.
    const sel = store.selection;
    if (e.shiftKey) {
      store.toggleInSelection(id);
    } else if (!sel.includes(id)) {
      store.setSelection([id]);
    }

    // Begin drag with the post-click selection.
    const targets = e.shiftKey
      ? useEditorStore.getState().selection
      : sel.includes(id)
        ? sel
        : [id];
    if (targets.length === 0) return;

    const internal = useEditorStore.getState().internal;
    const originals = new Map<ElementId, ResolvedPlacement>();
    for (const tid of targets) {
      const p = internal.layout.get(tid);
      if (p) originals.set(tid, { ...p });
    }
    if (originals.size === 0) return;

    drag = {
      pointerId: e.pointerId,
      startSvg: ctx.viewport.screenToSvg(e.clientX, e.clientY),
      originals,
      moved: false,
    };
    ctx.hostEl.setPointerCapture(e.pointerId);
    e.preventDefault();
  },

  onPointerMove(e, ctx) {
    if (drag && e.pointerId === drag.pointerId) {
      const cur = ctx.viewport.screenToSvg(e.clientX, e.clientY);
      const dx = snap(cur[0] - drag.startSvg[0]);
      const dy = snap(cur[1] - drag.startSvg[1]);
      if (!drag.moved && (dx !== 0 || dy !== 0)) drag.moved = true;

      const internal = useEditorStore.getState().internal;
      for (const [id, orig] of drag.originals) {
        const node = ctx.hostEl.querySelector<SVGGElement>(
          `[data-element-id="${cssEscape(id)}"]`,
        );
        if (!node) continue;
        const lib = internal.elements.get(id)?.libraryDef;
        const next: ResolvedPlacement = {
          ...orig,
          at: [orig.at[0] + dx, orig.at[1] + dy],
        };
        node.setAttribute('transform', transformAttr(next, lib));
      }
      return;
    }

    if (marquee && e.pointerId === marquee.pointerId) {
      const cur = ctx.viewport.screenToSvg(e.clientX, e.clientY);
      publishMarquee(rectFromPoints(marquee.startSvg, cur));
      return;
    }
  },

  onPointerUp(e, ctx) {
    if (drag && e.pointerId === drag.pointerId) {
      if (ctx.hostEl.hasPointerCapture(e.pointerId)) {
        ctx.hostEl.releasePointerCapture(e.pointerId);
      }
      if (drag.moved) {
        const cur = ctx.viewport.screenToSvg(e.clientX, e.clientY);
        const dx = snap(cur[0] - drag.startSvg[0]);
        const dy = snap(cur[1] - drag.startSvg[1]);
        if (dx !== 0 || dy !== 0) {
          const deltas = new Map<ElementId, [number, number]>();
          for (const id of drag.originals.keys()) deltas.set(id, [dx, dy]);
          useEditorStore.getState().moveElements(deltas);
        }
      }
      drag = null;
      return;
    }

    if (marquee && e.pointerId === marquee.pointerId) {
      if (ctx.hostEl.hasPointerCapture(e.pointerId)) {
        ctx.hostEl.releasePointerCapture(e.pointerId);
      }
      const end = ctx.viewport.screenToSvg(e.clientX, e.clientY);
      const rect = rectFromPoints(marquee.startSvg, end);
      // Only treat as a real marquee if the user actually dragged.
      if (rect.w >= MARQUEE_THRESHOLD || rect.h >= MARQUEE_THRESHOLD) {
        const hit = elementsInRect(rect);
        if (marquee.shiftKey) {
          // Shift-marquee toggles each hit element's membership.
          const baseSet = new Set(marquee.baseSelection);
          for (const id of hit) {
            if (baseSet.has(id)) baseSet.delete(id);
            else baseSet.add(id);
          }
          useEditorStore.getState().setSelection([...baseSet]);
        } else {
          useEditorStore.getState().setSelection(hit);
        }
      }
      publishMarquee(null);
      marquee = null;
    }
  },

  onDeactivate() {
    drag = null;
    marquee = null;
    publishMarquee(null);
  },
};

function rectFromPoints(a: [number, number], b: [number, number]): MarqueeRect {
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  const w = Math.abs(b[0] - a[0]);
  const h = Math.abs(b[1] - a[1]);
  return { x, y, w, h };
}

/**
 * Pick all element IDs whose library viewBox (transformed to world coords)
 * intersects the marquee rect. We approximate with the axis-aligned bbox of
 * the four corners after applying placement.
 */
function elementsInRect(rect: MarqueeRect): ElementId[] {
  const { internal } = useEditorStore.getState();
  const hits: ElementId[] = [];
  for (const re of internal.elements.values()) {
    if (!re.libraryDef) continue;
    const place = internal.layout.get(re.element.id);
    if (!place) continue;
    const vb = parseViewBox(re.libraryDef.viewBox);
    if (!vb) continue;
    const lib = libraryById[re.element.kind];
    const stretch = lib?.stretchable;
    let sx = 1;
    let sy = 1;
    if (stretch && place.span && lib) {
      const refLen = stretchReference(lib, stretch.axis);
      if (refLen > 0) {
        const k = place.span / refLen;
        if (stretch.axis === 'x') sx = k;
        else sy = k;
      }
    }
    const corners: [number, number][] = [
      [vb.x * sx, vb.y * sy],
      [(vb.x + vb.w) * sx, vb.y * sy],
      [vb.x * sx, (vb.y + vb.h) * sy],
      [(vb.x + vb.w) * sx, (vb.y + vb.h) * sy],
    ].map(([x, y]) => transformLocalCorner([x, y], place));

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of corners) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (
      maxX >= rect.x &&
      minX <= rect.x + rect.w &&
      maxY >= rect.y &&
      minY <= rect.y + rect.h
    ) {
      hits.push(re.element.id);
    }
  }
  return hits;
}

function transformLocalCorner(
  pt: [number, number],
  p: ResolvedPlacement,
): [number, number] {
  let [x, y] = pt;
  if (p.mirror) x = -x;
  switch (p.rot) {
    case 0:
      break;
    case 90:
      [x, y] = [-y, x];
      break;
    case 180:
      [x, y] = [-x, -y];
      break;
    case 270:
      [x, y] = [y, -x];
      break;
  }
  return [x + p.at[0], y + p.at[1]];
}

function parseViewBox(s: string) {
  const parts = s.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
}

function stretchReference(
  lib: { terminals: { x: number; y: number }[] },
  axis: 'x' | 'y',
): number {
  if (lib.terminals.length < 2) return 0;
  const vs = lib.terminals.map((t) => (axis === 'x' ? t.x : t.y));
  return Math.max(...vs) - Math.min(...vs);
}

function cssEscape(s: string): string {
  return s.replace(/(["\\])/g, '\\$1');
}
