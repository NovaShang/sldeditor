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

import { useEditorStore } from '../../store';
import type { ResolvedPlacement } from '../../compiler';
import type { AnnotationId, ElementId, WireEnd } from '../../model';
import { snap } from '../grid';
import { hitAnnotation, hitElement, hitNode, hitTerminal, hitWire } from '../hit-test';
import { publishMarquee, type MarqueeRect } from '../marquee-bus';
import { resolveWireTarget } from '../resolve-wire-target';
import { transformAttr } from '../transform-attr';
import { publishWireTarget } from '../wire-target-bus';
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

interface WireDragState {
  pointerId: number;
  fromRef: WireEnd;
}

interface AnnotationDragState {
  pointerId: number;
  id: AnnotationId;
  startSvg: [number, number];
  origin: [number, number];
  moved: boolean;
}

let drag: DragState | null = null;
let marquee: MarqueeState | null = null;
let wireDrag: WireDragState | null = null;
let annDrag: AnnotationDragState | null = null;

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

    const store = useEditorStore.getState();

    // Free text annotation: takes priority over element / terminal because
    // the annotation rect can overlap them visually. Click selects + arms
    // a drag; double-click (separate handler) enters edit mode.
    const annId = hitAnnotation(e.target);
    if (annId) {
      e.preventDefault();
      e.stopPropagation();
      const ann = store.diagram.annotations?.find((a) => a.id === annId);
      if (!ann) return;
      store.setSelectedAnnotation(annId);
      annDrag = {
        pointerId: e.pointerId,
        id: annId,
        startSvg: ctx.viewport.screenToSvg(e.clientX, e.clientY),
        origin: [ann.at[0], ann.at[1]],
        moved: false,
      };
      // Capture deferred to first real movement (see element-drag note).
      return;
    }

    // If the user clicked a terminal on a currently-selected element, start a
    // wire drag — same gesture as the wire tool, but available without
    // switching modes. The selection set is the gating affordance. We only
    // accept *direct* terminal hits (`data-terminal-id` ancestor); the
    // busbar-body fallback in `hitTerminal` is excluded so dragging the bus
    // body still moves the bus instead of starting a wire.
    const directTerm =
      e.target instanceof Element
        ? e.target.closest('[data-terminal-id]')?.getAttribute('data-terminal-id')
        : null;
    const termRef = directTerm ? hitTerminal(e.target) : null;
    if (termRef) {
      const dot = termRef.indexOf('.');
      const elemId = dot > 0 ? termRef.slice(0, dot) : '';
      if (elemId && store.selection.includes(elemId)) {
        e.preventDefault();
        e.stopPropagation();
        if (
          e.target instanceof Element &&
          e.target.hasPointerCapture?.(e.pointerId)
        ) {
          e.target.releasePointerCapture(e.pointerId);
        }
        ctx.hostEl.classList.add('tool-wire');
        store.setWireFromTerminal(termRef);
        store.setCursorSvg(ctx.viewport.screenToSvg(e.clientX, e.clientY));
        wireDrag = { pointerId: e.pointerId, fromRef: termRef };
        return;
      }
    }

    const id = hitElement(e.target);

    if (!id) {
      // Click on a wire → select that single Wire. Alt-click selects the
      // whole electrical node (every wire sharing the same potential).
      const wireId = hitWire(e.target);
      if (wireId) {
        e.preventDefault();
        if (e.altKey) {
          const nodeId = hitNode(e.target);
          if (nodeId) {
            store.setSelectedNode(nodeId);
            return;
          }
        }
        store.setSelectedWire(wireId);
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
    // Defer pointer capture until the user actually starts moving (in
    // onPointerMove) — capturing on pointerdown can interfere with the
    // browser synthesizing `dblclick` from a click pair on the same target.
    e.preventDefault();
  },

  onPointerMove(e, ctx) {
    if (annDrag && e.pointerId === annDrag.pointerId) {
      const cur = ctx.viewport.screenToSvg(e.clientX, e.clientY);
      const dx = snap(cur[0] - annDrag.startSvg[0]);
      const dy = snap(cur[1] - annDrag.startSvg[1]);
      if (!annDrag.moved && (dx !== 0 || dy !== 0)) {
        annDrag.moved = true;
        if (!ctx.hostEl.hasPointerCapture(e.pointerId)) {
          ctx.hostEl.setPointerCapture(e.pointerId);
        }
      }
      // DOM-direct preview: update the wrapper group's transform so the
      // drag stays smooth. The store mutation lands once on pointerup.
      const node = ctx.hostEl.querySelector<SVGGElement>(
        `[data-annotation-id="${cssEscape(annDrag.id)}"]`,
      );
      if (node) node.setAttribute('transform', `translate(${dx} ${dy})`);
      return;
    }

    if (wireDrag && e.pointerId === wireDrag.pointerId) {
      const pt = ctx.viewport.screenToSvg(e.clientX, e.clientY);
      useEditorStore.getState().setCursorSvg(pt);
      // Pointer capture would pin `e.target` to the origin terminal — sample
      // what's actually under the cursor for the live drop-target marker.
      const under =
        typeof document !== 'undefined'
          ? document.elementFromPoint(e.clientX, e.clientY)
          : null;
      const ref = under ? hitTerminal(under) : null;
      if (!ref || ref === wireDrag.fromRef) {
        publishWireTarget(null);
        return;
      }
      publishWireTarget(resolveWireTarget(ref, pt));
      return;
    }

    if (drag && e.pointerId === drag.pointerId) {
      const cur = ctx.viewport.screenToSvg(e.clientX, e.clientY);
      const dx = snap(cur[0] - drag.startSvg[0]);
      const dy = snap(cur[1] - drag.startSvg[1]);
      if (!drag.moved && (dx !== 0 || dy !== 0)) {
        drag.moved = true;
        if (!ctx.hostEl.hasPointerCapture(e.pointerId)) {
          ctx.hostEl.setPointerCapture(e.pointerId);
        }
      }

      for (const [id, orig] of drag.originals) {
        const node = ctx.hostEl.querySelector<SVGGElement>(
          `[data-element-id="${cssEscape(id)}"]`,
        );
        if (!node) continue;
        const next: ResolvedPlacement = {
          ...orig,
          at: [orig.at[0] + dx, orig.at[1] + dy],
        };
        node.setAttribute('transform', transformAttr(next));
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
    if (annDrag && e.pointerId === annDrag.pointerId) {
      if (ctx.hostEl.hasPointerCapture(e.pointerId)) {
        ctx.hostEl.releasePointerCapture(e.pointerId);
      }
      const cur = ctx.viewport.screenToSvg(e.clientX, e.clientY);
      const dx = snap(cur[0] - annDrag.startSvg[0]);
      const dy = snap(cur[1] - annDrag.startSvg[1]);
      const node = ctx.hostEl.querySelector<SVGGElement>(
        `[data-annotation-id="${cssEscape(annDrag.id)}"]`,
      );
      // Reset the preview transform — store update will repaint at the new at.
      if (node) node.removeAttribute('transform');
      if (annDrag.moved && (dx !== 0 || dy !== 0)) {
        useEditorStore.getState().updateAnnotation(annDrag.id, {
          at: [annDrag.origin[0] + dx, annDrag.origin[1] + dy],
        });
      }
      annDrag = null;
      return;
    }

    if (wireDrag && e.pointerId === wireDrag.pointerId) {
      const store = useEditorStore.getState();
      const from = wireDrag.fromRef;
      wireDrag = null;
      ctx.hostEl.classList.remove('tool-wire');
      store.setWireFromTerminal(null);
      store.setCursorSvg(null);
      publishWireTarget(null);
      const ref = hitTerminal(e.target);
      if (ref && ref !== from) store.addWire(from, ref);
      return;
    }

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

  onPointerCancel(e, ctx) {
    // Pinch-zoom hijack interrupted the gesture. Cleanly drop any in-flight
    // drag/marquee/wire/annotation state without committing — we don't want
    // to apply a move/marquee at the synthetic cancel coordinates.
    if (annDrag && e.pointerId === annDrag.pointerId) {
      const node = ctx.hostEl.querySelector<SVGGElement>(
        `[data-annotation-id="${cssEscape(annDrag.id)}"]`,
      );
      if (node) node.removeAttribute('transform');
      if (ctx.hostEl.hasPointerCapture?.(e.pointerId)) {
        try {
          ctx.hostEl.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      annDrag = null;
    }
    if (drag && e.pointerId === drag.pointerId) {
      // Reset the live preview transforms so the elements snap back to
      // their pre-drag placements (the store wasn't mutated yet).
      for (const [id, orig] of drag.originals) {
        const node = ctx.hostEl.querySelector<SVGGElement>(
          `[data-element-id="${cssEscape(id)}"]`,
        );
        if (!node) continue;
        node.setAttribute('transform', transformAttr(orig));
      }
      if (ctx.hostEl.hasPointerCapture?.(e.pointerId)) {
        try {
          ctx.hostEl.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      drag = null;
    }
    if (wireDrag && e.pointerId === wireDrag.pointerId) {
      ctx.hostEl.classList.remove('tool-wire');
      const store = useEditorStore.getState();
      store.setWireFromTerminal(null);
      store.setCursorSvg(null);
      publishWireTarget(null);
      wireDrag = null;
    }
    if (marquee && e.pointerId === marquee.pointerId) {
      if (ctx.hostEl.hasPointerCapture?.(e.pointerId)) {
        try {
          ctx.hostEl.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      publishMarquee(null);
      marquee = null;
    }
  },

  onDoubleClick(e) {
    const store = useEditorStore.getState();
    const annId = hitAnnotation(e.target);
    if (annId) {
      e.preventDefault();
      e.stopPropagation();
      store.setEditingAnnotation(annId);
      return;
    }
    const id = hitElement(e.target);
    if (id) {
      e.preventDefault();
      e.stopPropagation();
      store.setEditingElement(id);
    }
  },

  onDeactivate(ctx) {
    drag = null;
    marquee = null;
    annDrag = null;
    if (wireDrag) {
      ctx.hostEl.classList.remove('tool-wire');
      const store = useEditorStore.getState();
      store.setWireFromTerminal(null);
      store.setCursorSvg(null);
      publishWireTarget(null);
      wireDrag = null;
    }
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
    const corners: [number, number][] = [
      [vb.x, vb.y],
      [vb.x + vb.w, vb.y],
      [vb.x, vb.y + vb.h],
      [vb.x + vb.w, vb.y + vb.h],
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
  // Buses: a horizontal/vertical segment is a tight rect.
  for (const { bus, geometry } of internal.buses.values()) {
    const { axis, at, span } = geometry;
    const half = span / 2;
    const minX = axis === 'x' ? at[0] - half : at[0];
    const maxX = axis === 'x' ? at[0] + half : at[0];
    const minY = axis === 'x' ? at[1] : at[1] - half;
    const maxY = axis === 'x' ? at[1] : at[1] + half;
    if (
      maxX >= rect.x &&
      minX <= rect.x + rect.w &&
      maxY >= rect.y &&
      minY <= rect.y + rect.h
    ) {
      hits.push(bus.id);
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

function cssEscape(s: string): string {
  return s.replace(/(["\\])/g, '\\$1');
}
