/**
 * Dashed line from the chosen first terminal to the current cursor position
 * while the wire tool is mid-drag. The cursor coords are written to the
 * store by `WireTool.onPointerMove`.
 */

import { useEditorStore } from '@/store';

export function WirePreview() {
  const fromRef = useEditorStore((s) => s.wireFromTerminal);
  const cursor = useEditorStore((s) => s.cursorSvg);
  const terminals = useEditorStore((s) => s.internal.terminals);

  if (!fromRef || !cursor) return null;
  const from = terminals.get(fromRef);
  if (!from) return null;

  return (
    <g className="ole-wire-preview" pointerEvents="none">
      <line
        x1={from.world[0]}
        y1={from.world[1]}
        x2={cursor[0]}
        y2={cursor[1]}
        className="ole-wire-preview-line"
      />
      <circle
        cx={from.world[0]}
        cy={from.world[1]}
        r={4}
        className="ole-wire-preview-anchor"
      />
    </g>
  );
}
