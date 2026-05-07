/**
 * Renders a non-scaling stroke rect around every selected element using the
 * library's viewBox as the base bbox, then applying the same transform as
 * the element. CSS variable `--canvas-scale` keeps the visible stroke
 * width constant across zoom levels.
 */

import { useEditorStore } from '@/store';
import { transformAttr } from './transform-attr';

export function SelectionOverlay() {
  const selection = useEditorStore((s) => s.selection);
  const elements = useEditorStore((s) => s.internal.elements);
  const layout = useEditorStore((s) => s.internal.layout);

  if (selection.length === 0) return null;

  return (
    <g className="ole-selection-overlay" pointerEvents="none">
      {selection.map((id) => {
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
            transform={transformAttr(place, re.libraryDef)}
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
