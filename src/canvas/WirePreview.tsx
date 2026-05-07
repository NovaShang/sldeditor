/**
 * Dashed line from the chosen first terminal to the current cursor position
 * while the wire tool is mid-drag. When the cursor is over a valid drop
 * target (a terminal or a bus body), an additional ring + dot marks the
 * exact landing point so the user can release with confidence.
 */

import { useEffect, useState } from 'react';
import { useEditorStore } from '@/store';
import {
  getWireTarget,
  subscribeWireTarget,
  type WireTarget,
} from './wire-target-bus';

export function WirePreview() {
  const fromRef = useEditorStore((s) => s.wireFromTerminal);
  const cursor = useEditorStore((s) => s.cursorSvg);
  const terminals = useEditorStore((s) => s.internal.terminals);
  const [target, setTarget] = useState<WireTarget | null>(getWireTarget());

  useEffect(() => subscribeWireTarget(setTarget), []);

  if (!fromRef || !cursor) return null;
  const from = terminals.get(fromRef);
  if (!from) return null;

  // If we have a valid target, end the dashed line on it (snaps preview to
  // the actual landing point). Otherwise follow the raw cursor.
  const endX = target?.world[0] ?? cursor[0];
  const endY = target?.world[1] ?? cursor[1];

  return (
    <g className="ole-wire-preview" pointerEvents="none">
      <line
        x1={from.world[0]}
        y1={from.world[1]}
        x2={endX}
        y2={endY}
        className="ole-wire-preview-line"
      />
      <circle
        cx={from.world[0]}
        cy={from.world[1]}
        r={4}
        className="ole-wire-preview-anchor"
      />
      {target && (
        <>
          <circle
            cx={target.world[0]}
            cy={target.world[1]}
            r={target.isBusTap ? 7 : 8}
            className="ole-wire-preview-target-ring"
          />
          <circle
            cx={target.world[0]}
            cy={target.world[1]}
            r={target.isBusTap ? 3 : 4}
            className="ole-wire-preview-target-dot"
          />
        </>
      )}
    </g>
  );
}
