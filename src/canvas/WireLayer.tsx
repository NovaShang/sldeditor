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
 * with a small gap at the crossing so it's unambiguous they aren't joined —
 * or, when the document has `meta.wireHops`, one of them hops the other with
 * a small arc (geometry from the compiler, identical in every export).
 * A junction dot (rendered separately) remains the only "connected" signal.
 * The hit polyline is never gapped, so selection still spans the whole wire.
 *
 * A green-yellow (PE) wire gets a second, dashed polyline in the stripe
 * colour over its green base — the IEC 60445 look of the conductor itself.
 */

import { useMemo } from 'react';
import { useCanvasStore } from '../store';
import { findWireCrossings } from '../lib/wire-hops';
import type { WireRender } from '../compiler';
import { inkClass } from '../lib/colors';
import { PE_STRIPE_DASHARRAY } from '../lib/circuit-marks';
import { endOwner } from '../store/group-move';
import { maxAlarm, useRuntime } from '../runtime/runtime-context';
import type { AlarmLevel, Wire } from '../model';

type Pt = [number, number];

/** World-space half-width of the break drawn where a wire crosses under. */
const GAP_HALF = 4;

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

/** Cut points of the legacy crossing break, per "under" wire and segment. */
function gapCuts(
  renders: readonly WireRender[],
  wires: readonly Wire[] | undefined,
  terminalToNode: ReadonlyMap<string, string>,
): Map<string, Map<number, Pt[]>> {
  const cuts = new Map<string, Map<number, Pt[]>>();
  const wireToNode = new Map<string, string>();
  for (const w of wires ?? []) {
    const node = terminalToNode.get(w.ends[0]);
    if (node) wireToNode.set(w.id, node);
  }
  const runs = renders.map((r) => ({ id: r.wireId, path: r.path }));
  for (const x of findWireCrossings(runs)) {
    const a = renders[x.a.run].wireId;
    const b = renders[x.b.run].wireId;
    // Only gap genuinely different electrical nodes (same node = connected).
    const na = wireToNode.get(a);
    const nb = wireToNode.get(b);
    if (!(na && nb && na !== nb)) continue;
    const under = a < b ? x.a : x.b;
    const id = renders[under.run].wireId;
    let bySeg = cuts.get(id);
    if (!bySeg) {
      bySeg = new Map();
      cuts.set(id, bySeg);
    }
    const arr = bySeg.get(under.seg) ?? [];
    arr.push(x.at);
    bySeg.set(under.seg, arr);
  }
  return cuts;
}

export function WireLayer() {
  const wireRenders = useCanvasStore((s) => s.internal.wireRenders);
  const terminalToNode = useCanvasStore((s) => s.internal.terminalToNode);
  const wires = useCanvasStore((s) => s.diagram.wires);
  const selectedWire = useCanvasStore((s) => s.selectedWire);
  const selectedNode = useCanvasStore((s) => s.selectedNode);
  const hops = useCanvasStore((s) => s.diagram.meta?.wireHops === true);
  const runtime = useRuntime().props;

  // Build a quick wireId → nodeId lookup so each rendered polyline knows
  // its containing electrical node. In the same pass, a wire inherits the
  // alarm of whatever it is attached to: "the symbol AND the wires leaving
  // it" light up together, and a wire between two alarmed devices takes the
  // worse of the two. Deliberately per-wire, not per-node — the whole net
  // turning red would say "de-energised", which is a different feature.
  const wireToNode = new Map<string, string>();
  const wireAlarm = new Map<string, AlarmLevel>();
  for (const w of wires ?? []) {
    const node = terminalToNode.get(w.ends[0]);
    if (node) wireToNode.set(w.id, node);
    const level = maxAlarm(
      runtime[endOwner(w.ends[0])]?.alarm,
      runtime[endOwner(w.ends[1])]?.alarm,
    );
    if (level !== 'none') wireAlarm.set(w.id, level);
  }

  // ---- Crossings. A document with `meta.wireHops` draws the compiled
  // `drawn` polyline (arcs already sampled in by the compiler). Otherwise the
  // legacy break: for each different-net crossing, gap the "under" wire (the
  // one with the smaller wire id, deterministic). Memoised — the crossing scan
  // used to run all-pairs on every render, selection changes included.
  const renders = useMemo(
    () => Array.from(wireRenders.values()).filter((r) => r.path.length >= 2),
    [wireRenders],
  );
  const cuts = useMemo(
    () =>
      hops
        ? new Map<string, Map<number, Pt[]>>()
        : gapCuts(renders, wires, terminalToNode),
    [renders, hops, terminalToNode, wires],
  );

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
        const visibleSegments = r.drawn
          ? [r.drawn]
          : bySeg
            ? gapPath(path, bySeg)
            : [path];
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
              data-alarm={wireAlarm.get(r.wireId)}
              className={
                inkClass(r.color) ? `ole-wire ${inkClass(r.color)}` : 'ole-wire'
              }
              points={seg.map((p) => `${p[0]},${p[1]}`).join(' ')}
            />
          )),
          ...(r.color === 'green-yellow'
            ? visibleSegments.map((seg, idx) => (
                <polyline
                  key={`${r.wireId}-pe-${idx}`}
                  data-selected={selected}
                  className="ole-pe-stripe"
                  strokeDasharray={PE_STRIPE_DASHARRAY}
                  points={seg.map((p) => `${p[0]},${p[1]}`).join(' ')}
                />
              ))
            : []),
        ];
      })}
    </g>
  );
}
