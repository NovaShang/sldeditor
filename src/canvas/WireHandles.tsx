/**
 * Edit affordances for the selected wire's polyline path.
 *
 * Two handle kinds:
 *  - Vertex handle (filled): drag a corner; adjacent segments are
 *    synced to stay axis-aligned (H stays H, V stays V).
 *  - Midpoint handle (hollow): drag a segment perpendicular to its
 *    axis; inserts two new corners so the segment shifts in parallel.
 *
 * Endpoints (path[0], path[n-1]) are not draggable — they're locked to
 * terminals / bus anchors. A vertex with no remaining degree of freedom
 * (both neighbors are endpoint-adjacent on perpendicular axes — i.e.
 * the corner of a pure L) gets no handle: use the midpoint to add bends.
 *
 * The drag source is `internal.wireRenders[id].path` (works for both
 * manual paths and auto-routed paths — first edit materializes the
 * auto-routed path into `Wire.path`).
 */

import { useRef } from 'react';
import { useEditorStore } from '../store';
import type { WireId } from '../model';
import { getViewportApi } from './viewport-bus';
import { snap } from './grid';

type Pt = [number, number];
type Axis = 'h' | 'v';

const EPS = 0.5;

function segAxis(a: Pt, b: Pt): Axis {
  return Math.abs(a[1] - b[1]) < EPS ? 'h' : 'v';
}

export function WireHandles() {
  const selectedWire = useEditorStore((s) => s.selectedWire);
  const wireRenders = useEditorStore((s) => s.internal.wireRenders);

  if (!selectedWire) return null;
  const render = wireRenders.get(selectedWire);
  if (!render || render.path.length < 2) return null;

  const path = render.path;
  const n = path.length;

  // Interior vertex handles — only when at least one axis is free.
  const vertexHandles = [];
  for (let i = 1; i < n - 1; i++) {
    const prevAxis = segAxis(path[i - 1], path[i]);
    const nextAxis = segAxis(path[i], path[i + 1]);
    const prevEndpoint = i - 1 === 0;
    const nextEndpoint = i + 1 === n - 1;
    // A coordinate is locked when an endpoint-adjacent segment anchors it.
    // Horizontal segment to a fixed endpoint locks y; vertical locks x.
    const xLocked =
      (prevEndpoint && prevAxis === 'v') || (nextEndpoint && nextAxis === 'v');
    const yLocked =
      (prevEndpoint && prevAxis === 'h') || (nextEndpoint && nextAxis === 'h');
    if (xLocked && yLocked) continue;
    vertexHandles.push(
      <VertexHandle
        key={`v-${i}`}
        wireId={selectedWire}
        index={i}
        xLocked={xLocked}
        yLocked={yLocked}
      />,
    );
  }

  // Segment midpoint handles — one per segment.
  const midHandles = [];
  for (let s = 0; s < n - 1; s++) {
    const a = path[s];
    const b = path[s + 1];
    if (Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS) continue;
    midHandles.push(
      <MidpointHandle
        key={`m-${s}`}
        wireId={selectedWire}
        segIndex={s}
        axis={segAxis(a, b)}
      />,
    );
  }

  return (
    <g className="ole-wire-handles" pointerEvents="auto">
      {midHandles}
      {vertexHandles}
    </g>
  );
}

function VertexHandle({
  wireId,
  index,
  xLocked,
  yLocked,
}: {
  wireId: WireId;
  index: number;
  xLocked: boolean;
  yLocked: boolean;
}) {
  const viewport = getViewportApi();
  // dragRef snapshots the bits that pointermove needs. We deliberately do
  // NOT re-read them from props — the path mutates during the drag and a
  // re-render with shifted props would make subsequent moves contradict
  // the earlier moves (the H↔V oscillation the user reported).
  const dragRef = useRef<{
    pointerId: number;
    startPath: Pt[];
    startSvg: Pt;
    index: number;
    xLocked: boolean;
    yLocked: boolean;
  } | null>(null);

  const path = useEditorStore((s) => s.internal.wireRenders.get(wireId)?.path);
  if (!path || index <= 0 || index >= path.length - 1) return null;
  const [cx, cy] = path[index];

  const cursor = xLocked && !yLocked ? 'ns-resize' : !xLocked && yLocked ? 'ew-resize' : 'move';

  const onPointerDown = (e: React.PointerEvent<SVGCircleElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (!viewport) return;
    const cur = useEditorStore.getState().internal.wireRenders.get(wireId);
    if (!cur) return;
    dragRef.current = {
      pointerId: e.pointerId,
      startPath: cur.path.map((p) => [p[0], p[1]] as Pt),
      startSvg: viewport.screenToSvg(e.clientX, e.clientY),
      index,
      xLocked,
      yLocked,
    };
    document.body.style.cursor = cursor;
    (e.target as SVGCircleElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGCircleElement>) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId || !viewport) return;
    const cur = viewport.screenToSvg(e.clientX, e.clientY);
    const sp = drag.startPath;
    const idx = drag.index;
    if (idx <= 0 || idx >= sp.length - 1) return;
    const orig = sp[idx];
    const newPos: Pt = [
      drag.xLocked ? orig[0] : snap(orig[0] + (cur[0] - drag.startSvg[0])),
      drag.yLocked ? orig[1] : snap(orig[1] + (cur[1] - drag.startSvg[1])),
    ];
    if (newPos[0] === orig[0] && newPos[1] === orig[1]) return;

    const next = sp.map((p) => [p[0], p[1]] as Pt);
    next[idx] = newPos;
    const prevAxis = segAxis(sp[idx - 1], sp[idx]);
    if (idx - 1 > 0) {
      if (prevAxis === 'h') next[idx - 1] = [sp[idx - 1][0], newPos[1]];
      else next[idx - 1] = [newPos[0], sp[idx - 1][1]];
    }
    const nextAxis = segAxis(sp[idx], sp[idx + 1]);
    if (idx + 1 < sp.length - 1) {
      if (nextAxis === 'h') next[idx + 1] = [sp[idx + 1][0], newPos[1]];
      else next[idx + 1] = [newPos[0], sp[idx + 1][1]];
    }
    useEditorStore.getState().updateWirePath(wireId, next);
  };

  const finishDrag = (e: React.PointerEvent<SVGCircleElement>) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    if ((e.target as SVGCircleElement).hasPointerCapture(e.pointerId)) {
      (e.target as SVGCircleElement).releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
    document.body.style.cursor = '';
  };

  const onDoubleClick = (e: React.MouseEvent<SVGCircleElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const cur = useEditorStore.getState().internal.wireRenders.get(wireId);
    if (!cur || cur.path.length <= 2) return;
    if (index <= 0 || index >= cur.path.length - 1) return;
    const removed = cur.path.filter((_, i) => i !== index);
    useEditorStore.getState().updateWirePath(wireId, removed);
  };

  return (
    <circle
      className="ole-wire-handle ole-wire-vertex"
      cx={cx}
      cy={cy}
      r={5}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onDoubleClick={onDoubleClick}
    />
  );
}

function MidpointHandle({
  wireId,
  segIndex,
  axis,
}: {
  wireId: WireId;
  segIndex: number;
  axis: Axis;
}) {
  const viewport = getViewportApi();
  // dragRef pins axis + segIndex for the lifetime of the gesture. After the
  // first move splits the segment, the *live* prop `axis` flips H↔V on the
  // next render — if we re-read it here, the gesture would oscillate
  // between two shapes every frame.
  const dragRef = useRef<{
    pointerId: number;
    startPath: Pt[];
    startSvg: Pt;
    axis: Axis;
    segIndex: number;
  } | null>(null);

  const path = useEditorStore((s) => s.internal.wireRenders.get(wireId)?.path);
  if (!path || segIndex < 0 || segIndex >= path.length - 1) return null;
  const a = path[segIndex];
  const b = path[segIndex + 1];
  const cx = (a[0] + b[0]) / 2;
  const cy = (a[1] + b[1]) / 2;

  const cursor = axis === 'h' ? 'ns-resize' : 'ew-resize';

  const onPointerDown = (e: React.PointerEvent<SVGElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (!viewport) return;
    const cur = useEditorStore.getState().internal.wireRenders.get(wireId);
    if (!cur) return;
    dragRef.current = {
      pointerId: e.pointerId,
      startPath: cur.path.map((p) => [p[0], p[1]] as Pt),
      startSvg: viewport.screenToSvg(e.clientX, e.clientY),
      axis,
      segIndex,
    };
    document.body.style.cursor = cursor;
    (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGElement>) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId || !viewport) return;
    const cur = viewport.screenToSvg(e.clientX, e.clientY);
    const sp = drag.startPath;
    const seg = drag.segIndex;
    if (seg >= sp.length - 1) return;
    const segA = sp[seg];
    const segB = sp[seg + 1];
    const built: Pt[] = [];
    for (let i = 0; i <= seg; i++) built.push(sp[i]);
    if (drag.axis === 'h') {
      const newY = snap(segA[1] + (cur[1] - drag.startSvg[1]));
      built.push([segA[0], newY]);
      built.push([segB[0], newY]);
    } else {
      const newX = snap(segA[0] + (cur[0] - drag.startSvg[0]));
      built.push([newX, segA[1]]);
      built.push([newX, segB[1]]);
    }
    for (let i = seg + 1; i < sp.length; i++) built.push(sp[i]);
    useEditorStore.getState().updateWirePath(wireId, built);
  };

  const finishDrag = (e: React.PointerEvent<SVGElement>) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const t = e.currentTarget;
    if (t.hasPointerCapture(e.pointerId)) t.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    document.body.style.cursor = '';
  };

  // Render at the true midpoint (no grid snap) so the handle sits exactly
  // on top of the visible wire — otherwise on diagonal or off-grid
  // segments the handle drifts away from where the user expects to click.
  return (
    <g
      className="ole-wire-handle ole-wire-midpoint-group"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
    >
      {/* Invisible wider hit ring catches near-misses; the visible dot is
          smaller for visual polish. */}
      <circle
        className="ole-wire-midpoint-hit"
        cx={cx}
        cy={cy}
        r={8}
      />
      <circle
        className="ole-wire-handle ole-wire-midpoint"
        cx={cx}
        cy={cy}
        r={3.5}
      />
    </g>
  );
}
