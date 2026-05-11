/**
 * Stretch handles for the selected bus. Two `<circle>` grips at the bus's
 * endpoints. Dragging a grip updates the bus's `span`, and — for the
 * trailing grip — shifts `at` so the opposite end stays fixed visually.
 *
 * Handles capture pointer events themselves; SelectTool sees the drag start
 * on a non-element target and won't try to also move the bus body.
 */

import { useRef } from 'react';
import { useEditorStore } from '../store';
import type { BusId } from '../model';
import { getViewportApi } from './viewport-bus';
import { isSnapEnabled, GRID_SIZE } from './grid';

const MIN_SPAN = 20;

export function BusHandles() {
  const selection = useEditorStore((s) => s.selection);
  const internal = useEditorStore((s) => s.internal);

  if (selection.length !== 1) return null;
  const id = selection[0];
  const rb = internal.buses.get(id);
  if (!rb) return null;

  const { axis, at, span } = rb.geometry;
  const half = span / 2;
  const startWorld: [number, number] =
    axis === 'x' ? [at[0] - half, at[1]] : [at[0], at[1] - half];
  const endWorld: [number, number] =
    axis === 'x' ? [at[0] + half, at[1]] : [at[0], at[1] + half];

  return (
    <g className="ole-bus-handles" pointerEvents="auto">
      <Handle
        x={startWorld[0]}
        y={startWorld[1]}
        busId={id}
        side="start"
        axis={axis}
      />
      <Handle
        x={endWorld[0]}
        y={endWorld[1]}
        busId={id}
        side="end"
        axis={axis}
      />
    </g>
  );
}

function Handle({
  x,
  y,
  busId,
  side,
  axis,
}: {
  x: number;
  y: number;
  busId: BusId;
  side: 'start' | 'end';
  axis: 'x' | 'y';
}) {
  const viewport = getViewportApi();
  const dragRef = useRef<{
    pointerId: number;
    startSpan: number;
    startAt: [number, number];
    startSvg: [number, number];
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent<SVGCircleElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (!viewport) return;
    const rb = useEditorStore.getState().internal.buses.get(busId);
    if (!rb) return;
    dragRef.current = {
      pointerId: e.pointerId,
      startSpan: rb.geometry.span,
      startAt: [...rb.geometry.at],
      startSvg: viewport.screenToSvg(e.clientX, e.clientY),
    };
    (e.target as SVGCircleElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGCircleElement>) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId || !viewport) return;
    const cur = viewport.screenToSvg(e.clientX, e.clientY);
    const dRaw = axis === 'x' ? cur[0] - drag.startSvg[0] : cur[1] - drag.startSvg[1];
    const d = isSnapEnabled() ? Math.round(dRaw / GRID_SIZE) * GRID_SIZE : dRaw;

    const span = drag.startSpan + (side === 'end' ? d : -d);
    if (span < MIN_SPAN) return;
    const at: [number, number] =
      axis === 'x'
        ? [drag.startAt[0] + d / 2, drag.startAt[1]]
        : [drag.startAt[0], drag.startAt[1] + d / 2];

    useEditorStore.getState().updateBus(busId, { span, at });
  };

  const onPointerUp = (e: React.PointerEvent<SVGCircleElement>) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    if ((e.target as SVGCircleElement).hasPointerCapture(e.pointerId)) {
      (e.target as SVGCircleElement).releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
  };

  return (
    <circle
      className="ole-bus-handle"
      cx={x}
      cy={y}
      r={5}
      data-handle={side}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}
