/**
 * Canvas side of the circuit-diagram marks (see `lib/circuit-marks.ts`, which
 * the SVG and DXF exporters share):
 *
 *   - `SolderDotLayer` — the solder dots a circuit diagram adds to the
 *     junction dots: a T at a device pin, a tap off a bus.
 *   - `PinLabelLayer` — pin designations (A1/A2, 13/14…) beside every
 *     terminal, upright whatever the symbol's rotation. Hidden with the other
 *     labels at label mode 'off'.
 *
 * Both render nothing for a single-line document. Neither takes pointer
 * events: they are ink, not handles.
 */

import { useMemo } from 'react';
import { useCanvasStore } from '../store';
import { circuitSolderDots, pinLabelFontSize, placePinLabels } from '../lib/circuit-marks';
import { resolveLabelFontSize } from '../lib/element-labels';
import { useRuntime } from '../runtime/runtime-context';

/** Matches the junction layer's dot. */
const DOT_R = 2.5;

export function SolderDotLayer() {
  const internal = useCanvasStore((s) => s.internal);
  const dots = useMemo(() => circuitSolderDots(internal), [internal]);
  if (dots.length === 0) return null;
  return (
    <g className="ole-solder-dot-layer" pointerEvents="none">
      {dots.map(([x, y]) => (
        <circle key={`${x},${y}`} cx={x} cy={y} r={DOT_R} className="ole-solder-dot" />
      ))}
    </g>
  );
}

export function PinLabelLayer() {
  const internal = useCanvasStore((s) => s.internal);
  const off = useCanvasStore((s) => s.diagram.meta?.labelMode === 'off');
  const labelFs = useCanvasStore((s) => resolveLabelFontSize(s.diagram.meta?.labelFontSize));
  const runtime = useRuntime().props;
  const pins = useMemo(
    () => (off ? [] : placePinLabels(internal, labelFs, (id) => runtime[id]?.visible === false)),
    [internal, labelFs, off, runtime],
  );
  if (pins.length === 0) return null;
  return (
    <g
      className="ole-pin-label-layer"
      pointerEvents="none"
      style={{ fontSize: `${pinLabelFontSize(labelFs)}px` }}
    >
      {pins.map((p) => (
        <text key={p.ref} data-pin-label={p.ref} x={p.x} y={p.y} textAnchor={p.anchor} className="ole-pin-label">
          {p.text}
        </text>
      ))}
    </g>
  );
}
