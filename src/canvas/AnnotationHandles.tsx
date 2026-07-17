/**
 * Edit handles for the selected annotation:
 *   - rect / table: 8 resize grips (corners + edge midpoints);
 *   - table: extra invisible strips over internal column/row borders that
 *     drag individual column widths / row heights (Excel-style);
 *   - line: one grip per vertex (shift = 45° constraint against its
 *     neighbor);
 *   - text: none (font size lives in the property panel).
 *
 * Handles capture their own pointer events (SelectTool ignores
 * `.ole-annotation-handle` targets). During a drag the new geometry is
 * published as `annotationPreview` — a store-ephemeral override the
 * annotation layer renders instead of the model — and committed as a single
 * `updateAnnotation` on release, so one drag = one undo entry.
 */

import { useRef } from 'react';
import { useEditorStore } from '../store';
import {
  annotationKind,
  type Annotation,
  type LineAnnotation,
  type RectAnnotation,
  type TableAnnotation,
} from '../model';
import {
  constrain45,
  lineAbsPoints,
  MIN_RECT_SIZE,
  TABLE_MIN_COL_W,
  TABLE_MIN_ROW_H,
  tableColEdges,
  tableRowEdges,
  tableSize,
} from '../lib/annotation-geom';
import { getViewportApi } from './viewport-bus';
import { snap } from './grid';

const HANDLE_SIZE = 7;
const STRIP_HALF = 3;

export function AnnotationHandles() {
  const selectedId = useEditorStore((s) => s.selectedAnnotation);
  const annotations = useEditorStore((s) => s.diagram.annotations);
  const preview = useEditorStore((s) => s.annotationPreview);
  const readOnly = useEditorStore((s) => s.readOnly);

  if (readOnly || !selectedId) return null;
  const model = (annotations ?? []).find((a) => a.id === selectedId);
  if (!model) return null;
  const ann = preview?.id === selectedId ? preview : model;

  switch (annotationKind(ann)) {
    case 'rect':
      return <BoxHandles ann={ann as RectAnnotation} model={model} />;
    case 'table':
      return <TableHandles ann={ann as TableAnnotation} model={model} />;
    case 'line':
      return <LineHandles ann={ann as LineAnnotation} model={model} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Shared drag plumbing
// ---------------------------------------------------------------------------

interface DragCtx<T extends Annotation> {
  pointerId: number;
  startSvg: [number, number];
  orig: T;
}

/**
 * Wires the pointer handlers for one grip. `onDelta` maps the drag vector to
 * a preview annotation; commit patches the model once on release.
 */
function useGripDrag<T extends Annotation>(
  model: Annotation,
  onDelta: (orig: T, dx: number, dy: number, e: PointerEvent) => T,
  commitFields: (final: T) => Record<string, unknown>,
) {
  const dragRef = useRef<DragCtx<T> | null>(null);

  const onPointerDown = (e: React.PointerEvent<SVGElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const viewport = getViewportApi();
    if (!viewport) return;
    dragRef.current = {
      pointerId: e.pointerId,
      startSvg: viewport.screenToSvg(e.clientX, e.clientY),
      orig: structuredClone(model) as T,
    };
    (e.target as SVGElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGElement>) => {
    const drag = dragRef.current;
    const viewport = getViewportApi();
    if (!drag || e.pointerId !== drag.pointerId || !viewport) return;
    const cur = viewport.screenToSvg(e.clientX, e.clientY);
    const dx = snap(cur[0] - drag.startSvg[0]);
    const dy = snap(cur[1] - drag.startSvg[1]);
    useEditorStore
      .getState()
      .setAnnotationPreview(onDelta(drag.orig, dx, dy, e.nativeEvent));
  };

  const onPointerUp = (e: React.PointerEvent<SVGElement>) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    const el = e.target as SVGElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    const store = useEditorStore.getState();
    const finalPreview = store.annotationPreview;
    store.setAnnotationPreview(null);
    if (finalPreview && finalPreview.id === model.id) {
      store.updateAnnotation(model.id, commitFields(finalPreview as T));
    }
  };

  const onPointerCancel = (e: React.PointerEvent<SVGElement>) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    useEditorStore.getState().setAnnotationPreview(null);
  };

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}

/** Resize a bounding box from one of 8 grips, clamped to a minimum size. */
function resizeBox(
  at: [number, number],
  size: [number, number],
  dirX: -1 | 0 | 1,
  dirY: -1 | 0 | 1,
  dx: number,
  dy: number,
  minW: number,
  minH: number,
): { at: [number, number]; size: [number, number] } {
  let [x, y] = at;
  let [w, h] = size;
  if (dirX === 1) w = Math.max(minW, size[0] + dx);
  if (dirX === -1) {
    w = Math.max(minW, size[0] - dx);
    x = at[0] + size[0] - w;
  }
  if (dirY === 1) h = Math.max(minH, size[1] + dy);
  if (dirY === -1) {
    h = Math.max(minH, size[1] - dy);
    y = at[1] + size[1] - h;
  }
  return { at: [x, y], size: [w, h] };
}

const GRIPS: { dirX: -1 | 0 | 1; dirY: -1 | 0 | 1; cursor: string }[] = [
  { dirX: -1, dirY: -1, cursor: 'nwse-resize' },
  { dirX: 0, dirY: -1, cursor: 'ns-resize' },
  { dirX: 1, dirY: -1, cursor: 'nesw-resize' },
  { dirX: 1, dirY: 0, cursor: 'ew-resize' },
  { dirX: 1, dirY: 1, cursor: 'nwse-resize' },
  { dirX: 0, dirY: 1, cursor: 'ns-resize' },
  { dirX: -1, dirY: 1, cursor: 'nesw-resize' },
  { dirX: -1, dirY: 0, cursor: 'ew-resize' },
];

function gripPos(
  at: [number, number],
  size: [number, number],
  dirX: -1 | 0 | 1,
  dirY: -1 | 0 | 1,
): [number, number] {
  const x = dirX === -1 ? at[0] : dirX === 1 ? at[0] + size[0] : at[0] + size[0] / 2;
  const y = dirY === -1 ? at[1] : dirY === 1 ? at[1] + size[1] : at[1] + size[1] / 2;
  return [x, y];
}

function Grip({
  pos,
  cursor,
  handlers,
}: {
  pos: [number, number];
  cursor: string;
  handlers: ReturnType<typeof useGripDrag>;
}) {
  return (
    <rect
      className="ole-annotation-handle"
      x={pos[0] - HANDLE_SIZE / 2}
      y={pos[1] - HANDLE_SIZE / 2}
      width={HANDLE_SIZE}
      height={HANDLE_SIZE}
      style={{ cursor }}
      onPointerDown={handlers.onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
    />
  );
}

// ---------------------------------------------------------------------------
// Rect
// ---------------------------------------------------------------------------

function BoxHandles({
  ann,
  model,
}: {
  ann: RectAnnotation;
  model: Annotation;
}) {
  return (
    <g className="ole-annotation-handles" pointerEvents="auto">
      {GRIPS.map((g, i) => (
        <RectGrip key={i} grip={g} ann={ann} model={model} />
      ))}
    </g>
  );
}

function RectGrip({
  grip,
  ann,
  model,
}: {
  grip: (typeof GRIPS)[number];
  ann: RectAnnotation;
  model: Annotation;
}) {
  const handlers = useGripDrag<RectAnnotation>(
    model,
    (orig, dx, dy) => {
      const r = resizeBox(
        orig.at,
        orig.size,
        grip.dirX,
        grip.dirY,
        dx,
        dy,
        MIN_RECT_SIZE,
        MIN_RECT_SIZE,
      );
      return { ...orig, at: r.at, size: r.size };
    },
    (final) => ({ at: final.at, size: final.size }),
  );
  return (
    <Grip
      pos={gripPos(ann.at, ann.size, grip.dirX, grip.dirY)}
      cursor={grip.cursor}
      handlers={handlers}
    />
  );
}

// ---------------------------------------------------------------------------
// Table — 8 outer grips (proportional scale) + per-border strips.
// ---------------------------------------------------------------------------

function TableHandles({
  ann,
  model,
}: {
  ann: TableAnnotation;
  model: Annotation;
}) {
  const size = tableSize(ann);
  const colE = tableColEdges(ann);
  const rowE = tableRowEdges(ann);
  return (
    <g className="ole-annotation-handles" pointerEvents="auto">
      {colE.slice(1, -1).map((cx, i) => (
        <ColStrip key={`c${i}`} index={i} x={ann.at[0] + cx} ann={ann} model={model} />
      ))}
      {rowE.slice(1, -1).map((ry, i) => (
        <RowStrip key={`r${i}`} index={i} y={ann.at[1] + ry} ann={ann} model={model} />
      ))}
      {GRIPS.map((g, i) => (
        <TableGrip key={i} grip={g} ann={ann} model={model} size={size} />
      ))}
    </g>
  );
}

function TableGrip({
  grip,
  ann,
  model,
  size,
}: {
  grip: (typeof GRIPS)[number];
  ann: TableAnnotation;
  model: Annotation;
  size: [number, number];
}) {
  const handlers = useGripDrag<TableAnnotation>(
    model,
    (orig, dx, dy) => {
      const origSize = tableSize(orig);
      const r = resizeBox(
        orig.at,
        origSize,
        grip.dirX,
        grip.dirY,
        dx,
        dy,
        TABLE_MIN_COL_W * orig.colWidths.length,
        TABLE_MIN_ROW_H * orig.rowHeights.length,
      );
      // Proportional scale, then clamp every track to its minimum. The
      // anchored edge is recomputed from the actual post-clamp totals so the
      // opposite edge stays visually fixed.
      const colWidths = scaleTracks(orig.colWidths, r.size[0] / origSize[0], TABLE_MIN_COL_W);
      const rowHeights = scaleTracks(orig.rowHeights, r.size[1] / origSize[1], TABLE_MIN_ROW_H);
      const w = colWidths.reduce((a, b) => a + b, 0);
      const h = rowHeights.reduce((a, b) => a + b, 0);
      const at: [number, number] = [
        grip.dirX === -1 ? orig.at[0] + origSize[0] - w : orig.at[0],
        grip.dirY === -1 ? orig.at[1] + origSize[1] - h : orig.at[1],
      ];
      return { ...orig, at, colWidths, rowHeights };
    },
    (final) => ({
      at: final.at,
      colWidths: final.colWidths,
      rowHeights: final.rowHeights,
    }),
  );
  return (
    <Grip
      pos={gripPos(ann.at, size, grip.dirX, grip.dirY)}
      cursor={grip.cursor}
      handlers={handlers}
    />
  );
}

function scaleTracks(tracks: number[], ratio: number, min: number): number[] {
  return tracks.map((t) => Math.max(min, Math.round(t * ratio)));
}

function ColStrip({
  index,
  x,
  ann,
  model,
}: {
  /** Index of the column to the *left* of this border. */
  index: number;
  x: number;
  ann: TableAnnotation;
  model: Annotation;
}) {
  const [, h] = tableSize(ann);
  const handlers = useGripDrag<TableAnnotation>(
    model,
    (orig, dx) => {
      const colWidths = [...orig.colWidths];
      colWidths[index] = Math.max(TABLE_MIN_COL_W, orig.colWidths[index] + dx);
      return { ...orig, colWidths };
    },
    (final) => ({ colWidths: final.colWidths }),
  );
  return (
    <rect
      className="ole-annotation-handle ole-annotation-handle-strip"
      x={x - STRIP_HALF}
      y={ann.at[1]}
      width={STRIP_HALF * 2}
      height={h}
      style={{ cursor: 'col-resize' }}
      onPointerDown={handlers.onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
    />
  );
}

function RowStrip({
  index,
  y,
  ann,
  model,
}: {
  /** Index of the row *above* this border. */
  index: number;
  y: number;
  ann: TableAnnotation;
  model: Annotation;
}) {
  const [w] = tableSize(ann);
  const handlers = useGripDrag<TableAnnotation>(
    model,
    (orig, _dx, dy) => {
      const rowHeights = [...orig.rowHeights];
      rowHeights[index] = Math.max(TABLE_MIN_ROW_H, orig.rowHeights[index] + dy);
      return { ...orig, rowHeights };
    },
    (final) => ({ rowHeights: final.rowHeights }),
  );
  return (
    <rect
      className="ole-annotation-handle ole-annotation-handle-strip"
      x={ann.at[0]}
      y={y - STRIP_HALF}
      width={w}
      height={STRIP_HALF * 2}
      style={{ cursor: 'row-resize' }}
      onPointerDown={handlers.onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
    />
  );
}

// ---------------------------------------------------------------------------
// Line — one grip per vertex.
// ---------------------------------------------------------------------------

function LineHandles({
  ann,
  model,
}: {
  ann: LineAnnotation;
  model: Annotation;
}) {
  const abs = lineAbsPoints(ann);
  return (
    <g className="ole-annotation-handles" pointerEvents="auto">
      {abs.map((p, i) => (
        <VertexGrip key={i} index={i} pos={p} model={model} />
      ))}
    </g>
  );
}

function VertexGrip({
  index,
  pos,
  model,
}: {
  index: number;
  pos: [number, number];
  model: Annotation;
}) {
  const handlers = useGripDrag<LineAnnotation>(
    model,
    (orig, dx, dy, e) => {
      const points = orig.points.map((p) => [...p] as [number, number]);
      let np: [number, number] = [
        orig.points[index][0] + dx,
        orig.points[index][1] + dy,
      ];
      if (e.shiftKey) {
        // Constrain against the adjacent vertex so leaders snap to 45°s.
        const anchor =
          orig.points[index - 1] ?? orig.points[index + 1] ?? ([0, 0] as [number, number]);
        np = constrain45(anchor, np);
      }
      points[index] = np;
      return { ...orig, points };
    },
    (final) => ({ points: final.points }),
  );
  return (
    <circle
      className="ole-annotation-handle"
      cx={pos[0]}
      cy={pos[1]}
      r={4.5}
      style={{ cursor: 'move' }}
      onPointerDown={handlers.onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
    />
  );
}
