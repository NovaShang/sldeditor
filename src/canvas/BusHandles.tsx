/**
 * Stretch handles for selected stretchable elements (busbar). Two `<circle>`
 * grips at the symbol's two endpoint terminals. Dragging a grip updates the
 * element's `span`, and — for the trailing grip — shifts `at` so the
 * opposite end stays fixed visually.
 *
 * Handles capture pointer events themselves; SelectTool sees the drag start
 * on a non-element target and won't try to also move the bus body.
 */

import { useRef } from 'react';
import { useEditorStore } from '@/store';
import { libraryById } from '@/element-library';
import type { ElementId } from '@/model';
import { getViewportApi } from './viewport-bus';
import { isSnapEnabled, GRID_SIZE } from './grid';
import { transformPoint } from '@/compiler';

const MIN_SPAN = 20;

export function BusHandles() {
  const selection = useEditorStore((s) => s.selection);
  const internal = useEditorStore((s) => s.internal);

  if (selection.length !== 1) return null;
  const id = selection[0];
  const re = internal.elements.get(id);
  if (!re?.libraryDef) return null;
  const lib = libraryById[re.element.kind];
  if (!lib?.stretchable) return null;
  const place = internal.layout.get(id);
  if (!place) return null;

  const axis = lib.stretchable.axis;
  // Endpoint terminals are the two with min/max coord along the stretch axis.
  const sorted = [...lib.terminals].sort((a, b) =>
    axis === 'x' ? a.x - b.x : a.y - b.y,
  );
  if (sorted.length < 2) return null;
  const startTerm = sorted[0];
  const endTerm = sorted[sorted.length - 1];

  // World coords of the visible endpoints (mirroring/rotating local positions
  // through the placement, scaled by the rendered span).
  const refLen = (axis === 'x' ? endTerm.x - startTerm.x : endTerm.y - startTerm.y) || 1;
  const k = (place.span ?? refLen) / refLen;
  const startLocal: [number, number] = [
    axis === 'x' ? startTerm.x * k : startTerm.x,
    axis === 'y' ? startTerm.y * k : startTerm.y,
  ];
  const endLocal: [number, number] = [
    axis === 'x' ? endTerm.x * k : endTerm.x,
    axis === 'y' ? endTerm.y * k : endTerm.y,
  ];
  const startWorld = transformPoint(startLocal, place);
  const endWorld = transformPoint(endLocal, place);

  return (
    <g className="ole-bus-handles" pointerEvents="auto">
      <Handle
        x={startWorld[0]}
        y={startWorld[1]}
        elementId={id}
        side="start"
        axis={axis}
      />
      <Handle
        x={endWorld[0]}
        y={endWorld[1]}
        elementId={id}
        side="end"
        axis={axis}
      />
    </g>
  );
}

function Handle({
  x,
  y,
  elementId,
  side,
  axis,
}: {
  x: number;
  y: number;
  elementId: ElementId;
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
    const place = useEditorStore.getState().internal.layout.get(elementId);
    if (!place) return;
    dragRef.current = {
      pointerId: e.pointerId,
      startSpan: place.span ?? 0,
      startAt: [...place.at],
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

    // End-grip drag of +d: span grows by +d.   Start-grip: span shrinks by -d.
    // For *either* grip, the bus center shifts +d/2 along the axis so that
    // the opposite endpoint stays visually fixed.
    const span = drag.startSpan + (side === 'end' ? d : -d);
    if (span < MIN_SPAN) return;
    const at: [number, number] =
      axis === 'x'
        ? [drag.startAt[0] + d / 2, drag.startAt[1]]
        : [drag.startAt[0], drag.startAt[1] + d / 2];

    useEditorStore.getState().updatePlacement(elementId, { span, at });
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
