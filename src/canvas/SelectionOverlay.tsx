/**
 * Renders a non-scaling stroke rect around every selected element / bus
 * using the library viewBox (devices) or BusGeometry (buses) as the base
 * bbox, then applying the same transform.
 */

import { useEditorStore } from '../store';
import { transformAttr } from './transform-attr';

export function SelectionOverlay() {
  const selection = useEditorStore((s) => s.selection);
  const elements = useEditorStore((s) => s.internal.elements);
  const layout = useEditorStore((s) => s.internal.layout);
  const buses = useEditorStore((s) => s.internal.buses);

  if (selection.length === 0) return null;

  return (
    <g className="ole-selection-overlay" pointerEvents="none">
      {selection.map((id) => {
        const rb = buses.get(id);
        if (rb) {
          const { axis, at, span } = rb.geometry;
          const half = span / 2;
          const x = axis === 'x' ? at[0] - half : at[0] - 4;
          const y = axis === 'x' ? at[1] - 4 : at[1] - half;
          const w = axis === 'x' ? span : 8;
          const h = axis === 'x' ? 8 : span;
          return (
            <rect
              key={id}
              x={x}
              y={y}
              width={w}
              height={h}
              fill="none"
              className="ole-selection-rect"
            />
          );
        }
        const re = elements.get(id);
        const place = layout.get(id);
        if (!re?.libraryDef || !place) return null;
        const bb = parseViewBox(re.libraryDef.viewBox);
        if (!bb) return null;
        return (
          <rect
            key={id}
            x={bb.x}
            y={bb.y}
            width={bb.w}
            height={bb.h}
            fill="none"
            className="ole-selection-rect"
            transform={transformAttr(place)}
          />
        );
      })}
    </g>
  );
}

function parseViewBox(s: string): { x: number; y: number; w: number; h: number } | null {
  const parts = s.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
}
