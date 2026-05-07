/**
 * Live preview for the busbar tool. Snaps the cursor to the dominant axis
 * (horizontal or vertical) so users see exactly the line that will be
 * created on pointerup.
 */

import { useEditorStore } from '@/store';

export function BusbarPreview() {
  const start = useEditorStore((s) => s.busbarDrawStart);
  const cursor = useEditorStore((s) => s.cursorSvg);

  if (!start || !cursor) return null;

  const dx = cursor[0] - start[0];
  const dy = cursor[1] - start[1];
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const endX = horizontal ? cursor[0] : start[0];
  const endY = horizontal ? start[1] : cursor[1];

  return (
    <g className="ole-busbar-preview" pointerEvents="none">
      <line
        x1={start[0]}
        y1={start[1]}
        x2={endX}
        y2={endY}
        className="ole-busbar-preview-line"
      />
      <circle
        cx={start[0]}
        cy={start[1]}
        r={3.5}
        className="ole-busbar-preview-anchor"
      />
      <circle
        cx={endX}
        cy={endY}
        r={3.5}
        className="ole-busbar-preview-anchor"
      />
    </g>
  );
}
