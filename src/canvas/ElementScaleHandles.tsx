/**
 * Corner grips that resize the selected symbol — the same gesture every
 * drawing tool uses. Drag any corner and the symbol grows or shrinks
 * continuously (no steps), with wires, terminals and its label following live.
 * Near 100% the size catches on 100% so the original size is easy to get back
 * to.
 *
 * The size follows the pointer's distance from the OPPOSITE corner, like
 * resizing a box anywhere else — the full diagonal gives every corner the same,
 * fine-grained feel. (Measuring from the placement anchor instead was the first
 * attempt: a transformer's anchor sits at its bottom pin, a few units from the
 * bottom corners, so a 40-pixel drag there jumped straight to 400%.) The
 * symbol itself still grows about its anchor, so it stays in its column and
 * its pins stay on the wiring it already lines up with.
 *
 * Single-target, like the annotation grips: a multi-selection shows none.
 * Pointer events are captured by the grip itself; the grips reuse
 * `.ole-annotation-handle`, which SelectTool already ignores, so grabbing one
 * never starts a move or clears the selection.
 *
 * The drag goes through `previewPlacement` and closes with `endGesture`, so
 * the whole drag is ONE undo entry and Escape-less cancels (pointercancel)
 * roll back to the size it had.
 */

import { useRef, useState } from 'react';
import { useEditorStore } from '../store';
import { transformPoint } from '../compiler';
import { SYMBOL_SCALE_MAX, SYMBOL_SCALE_MIN } from '../model';
import { getViewportApi } from './viewport-bus';

const HANDLE_SIZE = 7;
/** Within this of 1.0 the size catches on 100%. */
const SNAP_TO_ONE = 0.05;

export function ElementScaleHandles() {
  const selection = useEditorStore((s) => s.selection);
  const internal = useEditorStore((s) => s.internal);
  const readOnly = useEditorStore((s) => s.readOnly);
  const [live, setLive] = useState<{ scale: number; at: [number, number] } | null>(null);

  if (readOnly || selection.length !== 1) return null;
  const id = selection[0];
  const re = internal.elements.get(id);
  const place = internal.layout.get(id);
  if (!re?.libraryDef || !place) return null;
  const vb = re.libraryDef.viewBox.trim().split(/\s+/).map(Number);
  if (vb.length !== 4 || vb.some((n) => Number.isNaN(n))) return null;

  const [x, y, w, h] = vb;
  const corners = ([[x, y], [x + w, y], [x + w, y + h], [x, y + h]] as [number, number][]).map(
    (c) => transformPoint(c, place),
  );
  const minX = Math.min(...corners.map((c) => c[0]));
  const maxX = Math.max(...corners.map((c) => c[0]));
  const minY = Math.min(...corners.map((c) => c[1]));
  const maxY = Math.max(...corners.map((c) => c[1]));
  const box: [number, number][] = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
  const cursors = ['nwse-resize', 'nesw-resize', 'nwse-resize', 'nesw-resize'];

  return (
    <g className="ole-element-scale-handles" pointerEvents="auto">
      {box.map((pos, i) => (
        <ScaleGrip
          key={i}
          id={id}
          pos={pos}
          cursor={cursors[i]}
          opposite={box[(i + 2) % 4]}
          scale={place.scale ?? 1}
          onLive={setLive}
        />
      ))}
      {live && (
        <text
          className="ole-element-scale-readout"
          x={live.at[0]}
          y={live.at[1]}
          textAnchor="middle"
        >
          {Math.round(live.scale * 100)}%
        </text>
      )}
    </g>
  );
}

function ScaleGrip({
  id,
  pos,
  cursor,
  opposite,
  scale,
  onLive,
}: {
  id: string;
  pos: [number, number];
  cursor: string;
  opposite: [number, number];
  scale: number;
  onLive: (v: { scale: number; at: [number, number] } | null) => void;
}) {
  const drag = useRef<{
    pointerId: number;
    startScale: number;
    startDist: number;
    opposite: [number, number];
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent<SVGRectElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const viewport = getViewportApi();
    if (!viewport) return;
    const p = viewport.screenToSvg(e.clientX, e.clientY);
    const d = Math.hypot(p[0] - opposite[0], p[1] - opposite[1]);
    if (d < 1) return; // degenerate (zero-size) symbol
    drag.current = { pointerId: e.pointerId, startScale: scale, startDist: d, opposite };
    (e.target as SVGRectElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGRectElement>) => {
    const g = drag.current;
    const viewport = getViewportApi();
    if (!g || e.pointerId !== g.pointerId || !viewport) return;
    const p = viewport.screenToSvg(e.clientX, e.clientY);
    const d = Math.hypot(p[0] - g.opposite[0], p[1] - g.opposite[1]);
    let s = (g.startScale * d) / g.startDist;
    s = Math.min(SYMBOL_SCALE_MAX, Math.max(SYMBOL_SCALE_MIN, s));
    s = Math.round(s * 100) / 100;
    if (Math.abs(s - 1) < SNAP_TO_ONE) s = 1;
    useEditorStore.getState().previewPlacement(id, { scale: s });
    onLive({ scale: s, at: [p[0], p[1] - 10] });
  };

  const finish = (e: React.PointerEvent<SVGRectElement>, commit: boolean) => {
    const g = drag.current;
    if (!g || e.pointerId !== g.pointerId) return;
    drag.current = null;
    const el = e.target as SVGRectElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    onLive(null);
    useEditorStore.getState().endGesture(commit);
  };

  return (
    <rect
      className="ole-annotation-handle ole-element-scale-handle"
      x={pos[0] - HANDLE_SIZE / 2}
      y={pos[1] - HANDLE_SIZE / 2}
      width={HANDLE_SIZE}
      height={HANDLE_SIZE}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, true)}
      onPointerCancel={(e) => finish(e, false)}
    />
  );
}
