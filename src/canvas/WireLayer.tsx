/**
 * Renders one polyline per Wire. Each polyline carries `data-wire-id` so
 * hit-test resolves to the specific wire (not the whole electrical node)
 * and `data-node-id` for "select-whole-node" affordances.
 *
 * Each visible wire is paired with a wider invisible hit polyline. A 1px
 * wire is too thin to comfortably click; the hit poly catches pointer
 * events within ~8px of the line and carries the same data attributes.
 *
 * Crossing ≠ connecting: where two wires of *different* electrical nodes
 * cross with no junction, the deterministically-chosen "under" wire is drawn
 * with a small gap at the crossing so it's unambiguous they aren't joined.
 * A junction dot (rendered separately) remains the only "connected" signal.
 * The hit polyline is never gapped, so selection still spans the whole wire.
 */

import { useEditorStore } from '../store';

type Pt = [number, number];

/** World-space half-width of the break drawn where a wire crosses under. */
const GAP_HALF = 4;

/** Strictly-interior intersection of two segments, or null. */
function crossPoint(p1: Pt, p2: Pt, p3: Pt, p4: Pt): Pt | null {
  const d1x = p2[0] - p1[0];
  const d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0];
  const d2y = p4[1] - p3[1];
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-9) return null; // parallel / collinear
  const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / den;
  const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / den;
  const eps = 1e-6;
  if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null;
  return [p1[0] + t * d1x, p1[1] + t * d1y];
}

/** Split a polyline into sub-polylines, opening a 2·GAP_HALF gap at each cut. */
function gapPath(path: Pt[], cutsBySeg: Map<number, Pt[]>): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [path[0]];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const cuts = cutsBySeg.get(i);
    if (!cuts || cuts.length === 0) {
      cur.push(b);
      continue;
    }
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const along = (p: Pt) => (p[0] - a[0]) * ux + (p[1] - a[1]) * uy;
    const sorted = cuts.slice().sort((p, q) => along(p) - along(q));
    for (const c of sorted) {
      const d = along(c);
      const d1 = Math.max(0, d - GAP_HALF);
      const d2 = Math.min(len, d + GAP_HALF);
      cur.push([a[0] + ux * d1, a[1] + uy * d1]);
      out.push(cur);
      cur = [[a[0] + ux * d2, a[1] + uy * d2]];
    }
    cur.push(b);
  }
  out.push(cur);
  return out.filter((s) => s.length >= 2);
}

export function WireLayer() {
  const wireRenders = useEditorStore((s) => s.internal.wireRenders);
  const terminalToNode = useEditorStore((s) => s.internal.terminalToNode);
  const wires = useEditorStore((s) => s.diagram.wires);
  const selectedWire = useEditorStore((s) => s.selectedWire);
  const selectedNode = useEditorStore((s) => s.selectedNode);

  // Build a quick wireId → nodeId lookup so each rendered polyline knows
  // its containing electrical node.
  const wireToNode = new Map<string, string>();
  for (const w of wires ?? []) {
    const node = terminalToNode.get(w.ends[0]);
    if (node) wireToNode.set(w.id, node);
  }

  // ---- Crossing gaps: for each different-net segment crossing, gap the
  // "under" wire (the one with the smaller wire id, deterministic). Collect
  // cut points per wireId, grouped by which segment they fall on.
  const renders = Array.from(wireRenders.values()).filter((r) => r.path.length >= 2);
  const segs: { wireId: string; node?: string; i: number; a: Pt; b: Pt }[] = [];
  for (const r of renders) {
    const node = wireToNode.get(r.wireId);
    for (let i = 0; i < r.path.length - 1; i++) {
      segs.push({ wireId: r.wireId, node, i, a: r.path[i] as Pt, b: r.path[i + 1] as Pt });
    }
  }
  const cuts = new Map<string, Map<number, Pt[]>>();
  for (let x = 0; x < segs.length; x++) {
    for (let y = x + 1; y < segs.length; y++) {
      const s1 = segs[x];
      const s2 = segs[y];
      if (s1.wireId === s2.wireId) continue;
      // Only gap genuinely different electrical nodes (same node = connected).
      if (!(s1.node && s2.node && s1.node !== s2.node)) continue;
      const pt = crossPoint(s1.a, s1.b, s2.a, s2.b);
      if (!pt) continue;
      const under = s1.wireId < s2.wireId ? s1 : s2;
      let bySeg = cuts.get(under.wireId);
      if (!bySeg) {
        bySeg = new Map();
        cuts.set(under.wireId, bySeg);
      }
      const arr = bySeg.get(under.i) ?? [];
      arr.push(pt);
      bySeg.set(under.i, arr);
    }
  }

  return (
    <g className="ole-wire-layer" fill="none" stroke="currentColor" strokeWidth={1}>
      {renders.flatMap((r) => {
        const path = r.path as Pt[];
        const points = path.map((p) => `${p[0]},${p[1]}`).join(' ');
        const nodeId = wireToNode.get(r.wireId);
        const isWireSelected = selectedWire === r.wireId;
        const isNodeSelected = selectedNode != null && selectedNode === nodeId;
        const selected = isWireSelected || isNodeSelected ? 'true' : undefined;
        const bySeg = cuts.get(r.wireId);
        // Visible geometry: a single polyline, or gapped sub-polylines where
        // this wire crosses under another net.
        const visibleSegments = bySeg ? gapPath(path, bySeg) : [path];
        return [
          <polyline
            key={`hit-${r.wireId}`}
            data-wire-id={r.wireId}
            data-node-id={nodeId}
            className="ole-wire-hit"
            points={points}
          />,
          ...visibleSegments.map((seg, idx) => (
            <polyline
              key={`${r.wireId}-${idx}`}
              data-wire-id={r.wireId}
              data-node-id={nodeId}
              data-manual={r.userEdited ? 'true' : undefined}
              data-selected={selected}
              className="ole-wire"
              points={seg.map((p) => `${p[0]},${p[1]}`).join(' ')}
            />
          )),
        ];
      })}
    </g>
  );
}
