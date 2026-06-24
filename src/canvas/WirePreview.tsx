/**
 * Dashed line from the wire-drag origin to the current cursor while the wire
 * tool is mid-drag. The origin may be an existing terminal/bus/junction or a
 * free point in space (which will mint a junction on release). When the cursor
 * is over a valid drop target, a ring + dot marks the exact landing point; a
 * hollow ring marks a spot where a release would create a new junction.
 */

import { useEffect, useState } from 'react';
import { useEditorStore } from '../store';
import {
  getWireTarget,
  subscribeWireTarget,
  type WireTarget,
} from './wire-target-bus';

export function WirePreview() {
  const dragFrom = useEditorStore((s) => s.wireDragFrom);
  const cursor = useEditorStore((s) => s.cursorSvg);
  const [target, setTarget] = useState<WireTarget | null>(getWireTarget());

  useEffect(() => subscribeWireTarget(setTarget), []);

  if (!dragFrom || !cursor) return null;
  const fromWorld = dragFrom.world;

  // If we have a valid target, end the dashed line on it (snaps preview to
  // the actual landing point). Otherwise follow the raw cursor.
  const endX = target?.world[0] ?? cursor[0];
  const endY = target?.world[1] ?? cursor[1];
  const willCreate = target?.create === 'junction';

  return (
    <g className="ole-wire-preview" pointerEvents="none">
      <line
        x1={fromWorld[0]}
        y1={fromWorld[1]}
        x2={endX}
        y2={endY}
        className="ole-wire-preview-line"
      />
      <circle
        cx={fromWorld[0]}
        cy={fromWorld[1]}
        r={4}
        className="ole-wire-preview-anchor"
      />
      {target && (
        <>
          <circle
            cx={target.world[0]}
            cy={target.world[1]}
            r={target.isBus ? 7 : 8}
            className="ole-wire-preview-target-ring"
            data-create={willCreate ? 'true' : undefined}
          />
          {!willCreate && (
            <circle
              cx={target.world[0]}
              cy={target.world[1]}
              r={target.isBus ? 3 : 4}
              className="ole-wire-preview-target-dot"
            />
          )}
        </>
      )}
    </g>
  );
}
