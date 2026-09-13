/**
 * Live-data adornments drawn over the diagram by `<OneLineViewer>`:
 *
 *   - `value`  — small readout (with the tag's unit) at the symbol's
 *                bottom-right, clear of the structural label, which the
 *                library anchors at the symbol's top-right;
 *   - `badge`  — pill hanging off the top-right corner of the symbol;
 *   - `?`      — quality marker off the top-left corner when the element's
 *                data is `bad` or `stale` (the symbol itself is greyed by
 *                the stylesheet via `data-quality`).
 *
 * Both corner marks sit just OUTSIDE the box rather than centred on the
 * corner: most symbols take their wire through the top centre, and a pill
 * straddling the corner covers the wire end.
 *
 * Everything is positioned from the element's WORLD bounding box (library
 * viewBox through its placement), so a rotated or mirrored symbol keeps its
 * adornments upright and in the same corners. Buses use their geometry.
 *
 * The layer is `pointer-events: none`: adornments describe, they are never
 * click targets — a click "on" a badge lands on the symbol below it.
 */

import { transformPoint } from '../compiler';
import type { ResolvedPlacement } from '../compiler';
import { useCanvasStore } from '../store';
import { alarmAttr, useRuntime } from '../runtime/runtime-context';
import type { ResolvedElementProps } from '../runtime/bindings';

/** Type size of the adornments, in canvas units (labels default to 7). */
const FONT_SIZE = 6;
const BADGE_PAD_X = 3;
const BADGE_H = FONT_SIZE + 3;
const VALUE_GAP = 3;
const QUALITY_R = 4;
/** How far a corner mark overlaps the symbol box, in canvas units. */
const CORNER_OVERLAP = 2;

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function parseViewBox(s: string): [number, number, number, number] | null {
  const parts = s.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  return [parts[0], parts[1], parts[2], parts[3]];
}

/** World-space bbox of a library viewBox under a placement. */
function worldBox(viewBox: string, place: ResolvedPlacement): Box | null {
  const vb = parseViewBox(viewBox);
  if (!vb) return null;
  const [x, y, w, h] = vb;
  const corners: [number, number][] = [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ];
  const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const c of corners) {
    const [px, py] = transformPoint(c, place);
    if (px < box.minX) box.minX = px;
    if (py < box.minY) box.minY = py;
    if (px > box.maxX) box.maxX = px;
    if (py > box.maxY) box.maxY = py;
  }
  return box;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    // Enough precision for a readout, no float noise ("12.300000001 A").
    return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
  }
  if (typeof v === 'boolean') return v ? 'ON' : 'OFF';
  return String(v);
}

function Adornments({
  id,
  box,
  rt,
  unit,
}: {
  id: string;
  box: Box;
  rt: ResolvedElementProps;
  unit?: string;
}) {
  const flagged = rt.quality === 'bad' || rt.quality === 'stale';
  const valueText =
    rt.value !== undefined && rt.value !== null
      ? `${formatValue(rt.value)}${unit ? ` ${unit}` : ''}`
      : '';
  const badge = rt.badge ?? '';
  if (!flagged && !valueText && !badge) return null;

  const badgeW = badge.length * FONT_SIZE * 0.6 + BADGE_PAD_X * 2;
  return (
    <g className="ole-rt" data-rt-for={id} data-alarm={alarmAttr(rt)}>
      {valueText && (
        <text
          className="ole-rt-value"
          x={box.maxX + VALUE_GAP}
          y={box.maxY}
          textAnchor="start"
        >
          {valueText}
        </text>
      )}
      {badge && (
        <g
          className="ole-rt-badge"
          transform={`translate(${box.maxX + badgeW / 2 - CORNER_OVERLAP} ${box.minY})`}
        >
          <rect
            x={-badgeW / 2}
            y={-BADGE_H / 2}
            width={badgeW}
            height={BADGE_H}
            rx={BADGE_H / 2}
            className="ole-rt-badge-bg"
          />
          <text x={0} y={0} textAnchor="middle" className="ole-rt-badge-text">
            {badge}
          </text>
        </g>
      )}
      {flagged && (
        <g
          className="ole-rt-quality"
          data-quality={rt.quality}
          transform={`translate(${box.minX - QUALITY_R + CORNER_OVERLAP} ${box.minY})`}
        >
          <circle r={QUALITY_R} className="ole-rt-quality-bg" />
          <text x={0} y={0} textAnchor="middle" className="ole-rt-quality-text">
            ?
          </text>
        </g>
      )}
    </g>
  );
}

export function RuntimeOverlayLayer() {
  const { props: runtime, units } = useRuntime();
  const elements = useCanvasStore((s) => s.internal.elements);
  const layout = useCanvasStore((s) => s.internal.layout);
  const buses = useCanvasStore((s) => s.internal.buses);

  const ids = Object.keys(runtime);
  if (ids.length === 0) return null;

  return (
    <g className="ole-rt-layer" pointerEvents="none">
      {ids.map((id) => {
        const rt = runtime[id];
        if (rt.visible === false) return null;
        let box: Box | null = null;
        const re = elements.get(id);
        const place = layout.get(id);
        if (re?.libraryDef && place) {
          box = worldBox(re.libraryDef.viewBox, place);
        } else {
          const rb = buses.get(id);
          if (rb) {
            const { axis, at, span } = rb.geometry;
            const half = span / 2;
            box =
              axis === 'x'
                ? { minX: at[0] - half, maxX: at[0] + half, minY: at[1] - 4, maxY: at[1] + 4 }
                : { minX: at[0] - 4, maxX: at[0] + 4, minY: at[1] - half, maxY: at[1] + half };
          }
        }
        if (!box) return null;
        return <Adornments key={id} id={id} box={box} rt={rt} unit={units[id]} />;
      })}
    </g>
  );
}
