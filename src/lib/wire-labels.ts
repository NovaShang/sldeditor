/**
 * Wire label placement shared by the canvas annotation layer and the
 * SVG / DXF exporters — the wire-side sibling of `element-labels.ts`.
 * Keeping the math in one place ensures the three surfaces stay
 * byte-identical: what the user sees on the canvas is what lands in the
 * exported file.
 *
 * Wires never rotate or mirror, so placement is simpler than `placeLabel`:
 * anchor at the midpoint of the wire's *longest* rendered segment (the most
 * visually prominent stretch — short stubs near terminals make bad homes for
 * text) and offset perpendicular so the label never sits on the line. Text
 * always stays upright:
 *   - horizontal segment → centered above the midpoint
 *   - vertical segment   → to the right of the midpoint, flowing right
 */

import { LABEL_FONT_SIZE, LABEL_LINE_HEIGHT } from './element-labels';

/**
 * Perpendicular clearance between the wire line and the label text, at
 * `LABEL_FONT_SIZE`. Scales with the label font (see `placeWireLabel`) so the
 * optical gap stays constant when a document enlarges its labels.
 */
export const WIRE_LABEL_OFFSET = 8;

/** Fully-resolved label placement for one wire. */
export interface PlacedWireLabel {
  /** World position of the text anchor point (SVG baseline). */
  world: [number, number];
  /** SVG `text-anchor`: horizontal segments center, vertical ones flow right. */
  textAnchor: 'start' | 'middle';
}

/**
 * Place a wire label along a rendered polyline. Returns `null` when the path
 * is degenerate (fewer than two points, or zero length) — callers skip the
 * label entirely in that case.
 *
 * `fontSize` is the document's resolved label size (`DiagramMeta.labelFontSize`);
 * omitting it reproduces the default-size placement exactly.
 */
export function placeWireLabel(
  path: readonly [number, number][],
  fontSize: number = LABEL_FONT_SIZE,
): PlacedWireLabel | null {
  if (path.length < 2) return null;

  // Longest segment wins; ties keep the earliest (deterministic).
  let best = -1;
  let bestLen = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const len = Math.hypot(
      path[i + 1][0] - path[i][0],
      path[i + 1][1] - path[i][1],
    );
    if (len > bestLen) {
      bestLen = len;
      best = i;
    }
  }
  if (best < 0 || bestLen <= 0) return null;

  const [ax, ay] = path[best];
  const [bx, by] = path[best + 1];
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;

  const offset = (WIRE_LABEL_OFFSET * fontSize) / LABEL_FONT_SIZE;

  // Paths are orthogonal by invariant; classify by dominant axis so a stray
  // diagonal from legacy data still gets a sensible placement.
  if (Math.abs(bx - ax) >= Math.abs(by - ay)) {
    // Horizontal run: center the text above the midpoint.
    return { world: [mx, my - offset], textAnchor: 'middle' };
  }
  // Vertical run: text to the right of the midpoint. The +fontSize/3 nudges
  // the baseline so the line sits visually centered on the wire (same
  // convention as `fallbackAnchor` in element-labels.ts).
  return {
    world: [mx + offset, my + fontSize / 3],
    textAnchor: 'start',
  };
}

/** A placed wire label, possibly wrapped onto several lines. */
export interface PlacedWireLabelBlock extends PlacedWireLabel {
  /** Text lines, top to bottom. One line unless the label had to wrap. */
  lines: string[];
  /** Baseline-to-baseline distance between `lines`. */
  lineHeight: number;
}

/** The fields of a compiled `WireRender` that label placement reads. */
export interface WireRenderLike {
  wireId: string;
  path: readonly [number, number][];
  label?: string;
}

/** Clearance kept between a wrapped label and the wire it must not reach. */
const NEIGHBOUR_CLEARANCE = 4;
/** Never wrap narrower than this many characters — a column of fragments
 *  is worse than a slight overlap. */
const MIN_WRAP_CHARS = 6;

/**
 * Place every wire label of a drawing. Identical to `placeWireLabel` per wire,
 * with one addition: a label on a vertical run that would reach the next wire
 * to its right — parallel feeders off a panel bus, typically 80–120 units
 * apart — is wrapped at word boundaries to fit the gap, and the block stays
 * centred on the run's midpoint. A label that already fits keeps its single
 * line and its exact position, so drawings that never collided render as
 * they always did.
 *
 * Cable specifications are what made this matter: "4×16 mm² Cu XLPE/SWA/PVC"
 * on one feeder used to run across the next feeder and into its label.
 *
 * `renders` are the compiled wire renders (`InternalModel.wireRenders`); the
 * canvas and both exporters all call this, so they wrap identically.
 */
export function placeWireLabels(
  renders: ReadonlyMap<string, WireRenderLike>,
  fontSize: number = LABEL_FONT_SIZE,
): Map<string, PlacedWireLabelBlock> {
  const out = new Map<string, PlacedWireLabelBlock>();
  const lineHeight = (LABEL_LINE_HEIGHT * fontSize) / LABEL_FONT_SIZE;
  const charW = fontSize * 0.55;
  const offset = (WIRE_LABEL_OFFSET * fontSize) / LABEL_FONT_SIZE;
  let verticals: VRun[] | null = null;

  for (const r of renders.values()) {
    const label = r.label?.trim();
    if (!label) continue;
    const placed = placeWireLabel(r.path, fontSize);
    if (!placed) continue;
    let lines = [label];
    if (placed.textAnchor === 'start') {
      // A vertical run: the text flows right from x = wire + offset.
      const wireX = placed.world[0] - offset;
      const textEnd = placed.world[0] + label.length * charW;
      verticals ??= collectVerticals(renders);
      const gap = nearestRight(
        verticals,
        wireX,
        textEnd + NEIGHBOUR_CLEARANCE,
        placed.world[1] - fontSize,
        placed.world[1],
      );
      if (gap !== null) {
        const room = gap - offset - NEIGHBOUR_CLEARANCE;
        const maxChars = Math.max(MIN_WRAP_CHARS, Math.floor(room / charW));
        if (label.length > maxChars) lines = wrapWords(label, maxChars);
      }
    }
    if (lines.length === 1) {
      out.set(r.wireId, { ...placed, lines, lineHeight });
      continue;
    }
    // Centre the stacked block where the single line's baseline was.
    const shift = ((lines.length - 1) * lineHeight) / 2;
    out.set(r.wireId, {
      world: [placed.world[0], placed.world[1] - shift],
      textAnchor: placed.textAnchor,
      lines,
      lineHeight,
    });
  }
  return out;
}

interface VRun {
  x: number;
  y1: number;
  y2: number;
}

function collectVerticals(renders: ReadonlyMap<string, WireRenderLike>): VRun[] {
  const out: VRun[] = [];
  for (const r of renders.values()) {
    for (let i = 0; i < r.path.length - 1; i++) {
      const [ax, ay] = r.path[i];
      const [bx, by] = r.path[i + 1];
      if (Math.abs(ax - bx) < 0.5 && Math.abs(ay - by) >= 0.5) {
        out.push({ x: ax, y1: Math.min(ay, by), y2: Math.max(ay, by) });
      }
    }
  }
  return out.sort((a, b) => a.x - b.x);
}

/**
 * Distance from `x` to the nearest vertical run strictly to its right that
 * starts before `xMax` and overlaps the band `[yTop, yBot]`, or null.
 */
function nearestRight(
  vs: readonly VRun[],
  x: number,
  xMax: number,
  yTop: number,
  yBot: number,
): number | null {
  let lo = 0;
  let hi = vs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (vs[mid].x <= x + 0.5) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < vs.length && vs[i].x <= xMax; i++) {
    const v = vs[i];
    if (v.y2 >= yTop && v.y1 <= yBot) return v.x - x;
  }
  return null;
}

/** Greedy word wrap; a single word longer than `maxChars` keeps its own line. */
function wrapWords(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/)) {
    if (cur === '') cur = word;
    else if (cur.length + 1 + word.length <= maxChars) cur += ` ${word}`;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur !== '') lines.push(cur);
  return lines;
}
