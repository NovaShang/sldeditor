/**
 * Wire crossings: where two wires cross without connecting, and the "hop"
 * (a small arc on one of them) that says so on paper.
 *
 * One finder serves both crossing styles — the canvas's legacy break (a gap
 * in the "under" wire) and the document-level hop — so the two cannot
 * disagree about what a crossing is:
 *
 *   - strictly interior on BOTH segments. A wire ending on another (a tee)
 *     or two wires sharing an endpoint are connections, not crossings;
 *   - never on a junction dot (`avoid`): a dot there says "joined";
 *   - never a wire with itself, never parallel/collinear runs.
 *
 * Hop convention (documented on `DiagramMeta.wireHops`): at a horizontal /
 * vertical crossing the VERTICAL wire hops — in a single-line diagram the
 * horizontals are the long runs the feeders drop across, so the drop is the
 * one that jumps. Any other pair hops the wire later in the document.
 *
 * Cost: wires are orthogonal by invariant, so horizontals are sorted by y
 * and each vertical scans only the horizontals inside its own y-span —
 * O(S log S + K) for S segments and K candidate pairs, instead of the
 * all-pairs O(S²) the canvas gap used to run on every render. The rare
 * diagonal (legacy data) is checked against everything.
 */

type Pt = [number, number];

/** Arc radius of a hop, in world units (= the canvas gap's half-width). */
export const HOP_RADIUS = 4;
/** Tolerance for "on the endpoint" / "on the junction" — half a grid unit. */
const EPS = 0.5;
/** Segments per hop arc in the sampled polyline every renderer draws. */
const HOP_SEGMENTS = 8;

export interface WireRun {
  id: string;
  path: readonly (readonly [number, number])[];
}

export interface SegRef {
  /** Index of the run in the input array (document order). */
  run: number;
  /** Segment index along that run's path. */
  seg: number;
  /** Orientation class of the segment. */
  axis: 'h' | 'v' | 'd';
}

export interface WireCrossing {
  a: SegRef;
  b: SegRef;
  at: Pt;
}

interface HSeg {
  ref: SegRef;
  y: number;
  x1: number;
  x2: number;
}
interface VSeg {
  ref: SegRef;
  x: number;
  y1: number;
  y2: number;
}
interface DSeg {
  ref: SegRef;
  p: readonly [number, number];
  q: readonly [number, number];
}

/** Every unconnected crossing between distinct wires. */
export function findWireCrossings(
  runs: readonly WireRun[],
  avoid: readonly (readonly [number, number])[] = [],
): WireCrossing[] {
  const H: HSeg[] = [];
  const V: VSeg[] = [];
  const D: DSeg[] = [];
  runs.forEach((r, run) => {
    for (let seg = 0; seg < r.path.length - 1; seg++) {
      const p = r.path[seg];
      const q = r.path[seg + 1];
      const dx = Math.abs(q[0] - p[0]);
      const dy = Math.abs(q[1] - p[1]);
      if (dx < EPS && dy < EPS) continue;
      if (dy < EPS) {
        H.push({
          ref: { run, seg, axis: 'h' },
          y: p[1],
          x1: Math.min(p[0], q[0]),
          x2: Math.max(p[0], q[0]),
        });
      } else if (dx < EPS) {
        V.push({
          ref: { run, seg, axis: 'v' },
          x: p[0],
          y1: Math.min(p[1], q[1]),
          y2: Math.max(p[1], q[1]),
        });
      } else {
        D.push({ ref: { run, seg, axis: 'd' }, p, q });
      }
    }
  });

  const avoidSet = buildAvoid(avoid);
  const out: WireCrossing[] = [];
  const push = (a: SegRef, b: SegRef, at: Pt) => {
    if (!nearAvoid(avoidSet, at)) out.push({ a, b, at });
  };

  // Horizontal × vertical — the only pairs an orthogonal drawing has.
  H.sort((s, t) => s.y - t.y);
  const ys = H.map((h) => h.y);
  for (const v of V) {
    // First horizontal strictly below the vertical's top end (+EPS).
    let i = lowerBound(ys, v.y1 + EPS);
    for (; i < H.length; i++) {
      const h = H[i];
      if (h.y > v.y2 - EPS) break;
      if (h.y < v.y1 + EPS) continue;
      if (h.ref.run === v.ref.run) continue;
      if (v.x <= h.x1 + EPS || v.x >= h.x2 - EPS) continue;
      push(h.ref, v.ref, [v.x, h.y]);
    }
  }

  // Diagonals (legacy paths only) against everything.
  if (D.length > 0) {
    const all: DSeg[] = [
      ...H.map((h) => ({ ref: h.ref, p: [h.x1, h.y] as Pt, q: [h.x2, h.y] as Pt })),
      ...V.map((v) => ({ ref: v.ref, p: [v.x, v.y1] as Pt, q: [v.x, v.y2] as Pt })),
    ];
    for (let i = 0; i < D.length; i++) {
      const d = D[i];
      for (const o of all) {
        if (o.ref.run === d.ref.run) continue;
        const at = interiorCross(d.p, d.q, o.p, o.q);
        if (at) push(o.ref, d.ref, at);
      }
      for (let j = i + 1; j < D.length; j++) {
        const o = D[j];
        if (o.ref.run === d.ref.run) continue;
        const at = interiorCross(d.p, d.q, o.p, o.q);
        if (at) push(d.ref, o.ref, at);
      }
    }
  }
  return out;
}

/** Which wire hops at a crossing (see the module comment for the rule). */
export function hopper(x: WireCrossing): SegRef {
  if (x.a.axis === 'v' && x.b.axis === 'h') return x.a;
  if (x.b.axis === 'v' && x.a.axis === 'h') return x.b;
  return x.a.run > x.b.run ? x.a : x.b;
}

/**
 * Hop points per hopping wire, grouped by segment:
 * `wireId → segIndex → crossing points`.
 */
export function computeWireHops(
  runs: readonly WireRun[],
  avoid: readonly (readonly [number, number])[] = [],
): Map<string, Map<number, Pt[]>> {
  const out = new Map<string, Map<number, Pt[]>>();
  for (const x of findWireCrossings(runs, avoid)) {
    const h = hopper(x);
    const id = runs[h.run].id;
    let bySeg = out.get(id);
    if (!bySeg) {
      bySeg = new Map();
      out.set(id, bySeg);
    }
    const pts = bySeg.get(h.seg);
    if (pts) pts.push(x.at);
    else bySeg.set(h.seg, [x.at]);
  }
  return out;
}

/**
 * The polyline a hopping wire is drawn with: its own path with a sampled
 * half-ellipse at each hop. Sampled rather than an SVG arc command so the
 * canvas, the SVG/PNG/PDF export and the R12 DXF writer (no arcs in a
 * POLYLINE without bulge support) all draw the identical shape.
 *
 * Arcs closer together than one hop merge into a single wider arc, so a
 * wire crossing a tight bundle jumps it once instead of bouncing. An arc is
 * clipped to its own segment so it never runs round a corner.
 *
 * A horizontal-ish run bulges up, a vertical-ish run bulges right.
 */
export function hoppedPath(
  path: readonly (readonly [number, number])[],
  hopsBySeg: ReadonlyMap<number, readonly (readonly [number, number])[]>,
  radius = HOP_RADIUS,
): Pt[] {
  const out: Pt[] = [[path[0][0], path[0][1]]];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const hops = hopsBySeg.get(i);
    if (hops && hops.length > 0) {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        const ux = dx / len;
        const uy = dy / len;
        // Normal: up for horizontal-ish runs, right for vertical-ish ones.
        let nx = -uy;
        let ny = ux;
        if (Math.abs(ny) > Math.abs(nx) ? ny > 0 : nx < 0) {
          nx = -nx;
          ny = -ny;
        }
        const along = hops
          .map((p) => (p[0] - a[0]) * ux + (p[1] - a[1]) * uy)
          .sort((s, t) => s - t);
        // Merge overlapping [d - r, d + r] intervals, clipped to the segment.
        const spans: [number, number][] = [];
        for (const d of along) {
          const s = Math.max(0, d - radius);
          const e = Math.min(len, d + radius);
          const last = spans[spans.length - 1];
          if (last && s <= last[1]) last[1] = Math.max(last[1], e);
          else spans.push([s, e]);
        }
        const at = (d: number, off: number): Pt => [
          a[0] + ux * d + nx * off,
          a[1] + uy * d + ny * off,
        ];
        for (const [s, e] of spans) {
          if (s > 0) out.push(at(s, 0));
          const mid = (s + e) / 2;
          const rx = (e - s) / 2;
          for (let k = 1; k < HOP_SEGMENTS; k++) {
            const t = (Math.PI * k) / HOP_SEGMENTS;
            out.push(at(mid - rx * Math.cos(t), radius * Math.sin(t)));
          }
          if (e < len) out.push(at(e, 0));
        }
      }
    }
    out.push([b[0], b[1]]);
  }
  return out.map(([x, y]) => [round(x), round(y)] as Pt);
}

// ---------------------------------------------------------------------------

/** Strictly-interior intersection of segments pq and rs, or null. */
function interiorCross(
  p: readonly [number, number],
  q: readonly [number, number],
  r: readonly [number, number],
  s: readonly [number, number],
): Pt | null {
  const d1x = q[0] - p[0];
  const d1y = q[1] - p[1];
  const d2x = s[0] - r[0];
  const d2y = s[1] - r[1];
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((r[0] - p[0]) * d2y - (r[1] - p[1]) * d2x) / den;
  const u = ((r[0] - p[0]) * d1y - (r[1] - p[1]) * d1x) / den;
  const l1 = Math.hypot(d1x, d1y);
  const l2 = Math.hypot(d2x, d2y);
  // Interior by at least EPS world units on both segments.
  if (t * l1 <= EPS || (1 - t) * l1 <= EPS) return null;
  if (u * l2 <= EPS || (1 - u) * l2 <= EPS) return null;
  return [p[0] + t * d1x, p[1] + t * d1y];
}

function lowerBound(xs: readonly number[], v: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Junction points keyed by rounded coordinate for O(1) lookup. */
function buildAvoid(pts: readonly (readonly [number, number])[]): Set<number> {
  const set = new Set<number>();
  for (const p of pts) set.add(key(Math.round(p[0]), Math.round(p[1])));
  return set;
}

function nearAvoid(set: Set<number>, p: Pt): boolean {
  if (set.size === 0) return false;
  const x = Math.round(p[0]);
  const y = Math.round(p[1]);
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      if (set.has(key(x + ox, y + oy))) return true;
    }
  }
  return false;
}

/** Exact numeric key for integer coordinates within ±2^25. */
function key(x: number, y: number): number {
  return x * 67108864 + y;
}

/** Three decimals — enough for any zoom, short in the exported files. */
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
