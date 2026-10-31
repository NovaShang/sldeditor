/**
 * Wire numbering for circuit diagrams, by POTENTIAL.
 *
 * Every wire on one electrical node (the compiler's connectivity node: wires
 * joined through junctions, bus taps and same-named continuation connectors)
 * carries the same number, so "wire 7" means one conductor potential an
 * electrician can ring out, however many pieces of wire draw it.
 *
 * Rules:
 *   - Nodes are numbered 1…N in reading order: by the topmost point of the
 *     node's wires, then the leftmost; ties fall back to the node id so the
 *     order never depends on array order.
 *   - A node on a NAMED bus is a supply rail (L, N, +24V, 0V): its potential
 *     already has a name, so it gets no number.
 *   - A node touching a pin of a multi-pole POWER symbol (3-phase supply,
 *     3-pole breaker / contactor / overload relay, motor, 4-pole RCD, 1P+N
 *     MCB…) belongs to the main circuit, whose conductors are identified by
 *     their phase labels (L1/L2/L3/N/PE), not by numbers: no number.
 *   - A node where the user wrote a non-numeric label on any wire (L1, PE,
 *     24V…) is named by hand: the label is kept and the node gets no number.
 *   - Numeric labels are owned by this function: they are replaced on
 *     numbered nodes and removed on every unnumbered node above, so a stale
 *     number never survives a re-run.
 *
 * Re-running on an unchanged drawing gives the same result (labels do not
 * affect geometry or connectivity). Pure: the caller passes the compiled
 * model of the same document.
 */

import type { InternalModel } from '../compiler/internal-model';
import type { LibraryEntry } from './library';
import type { DiagramFile, NodeId, Wire } from './types';

export interface WireNumbering {
  /** The renumbered document — the input itself when no label changed. */
  diagram: DiagramFile;
  /** How many potentials received a number. */
  count: number;
}

const NUMERIC = /^\s*\d+\s*$/;

/** A label this function wrote (or could have): digits only. */
export function isWireNumber(label: string | undefined): boolean {
  return label !== undefined && NUMERIC.test(label);
}

/**
 * A main-circuit power symbol: circuit-only (`diagramTypes` has `circuit` and
 * not `sld`) with three or more terminals. Read from the library rather than
 * listed, so a new multi-pole power symbol is covered the day it is added;
 * control symbols (coils, contacts, buttons, lamps) have two terminals.
 */
export function isMainCircuitEntry(entry: Pick<LibraryEntry, 'diagramTypes' | 'terminals'> | undefined): boolean {
  const types = entry?.diagramTypes ?? [];
  return types.includes('circuit') && !types.includes('sld') && (entry?.terminals.length ?? 0) >= 3;
}

export function numberWiresByPotential(diagram: DiagramFile, m: InternalModel): WireNumbering {
  const wires = diagram.wires ?? [];
  // Group wires by node. A wire the compiler rejected (missing pin, unknown
  // element) belongs to no node and is left exactly as it is.
  const byNode = new Map<NodeId, Wire[]>();
  for (const w of wires) {
    const node = m.terminalToNode.get(w.ends[0]);
    if (!node || m.terminalToNode.get(w.ends[1]) !== node) continue;
    const list = byNode.get(node) ?? [];
    list.push(w);
    byNode.set(node, list);
  }

  const namedRail = (node: NodeId) =>
    (m.nodes.get(node)?.terminals ?? []).some((end) => !!m.buses.get(end)?.bus.name?.trim());
  const mainCircuit = (node: NodeId) =>
    (m.nodes.get(node)?.terminals ?? []).some((end) => {
      const dot = end.indexOf('.');
      return dot > 0 && isMainCircuitEntry(m.elements.get(end.slice(0, dot))?.libraryDef);
    });
  const namedByHand = (ws: Wire[]) => ws.some((w) => !!w.label?.trim() && !isWireNumber(w.label));

  /** Topmost, then leftmost point of the node's drawn wires. */
  const anchor = (ws: Wire[]): [number, number] => {
    let best: [number, number] = [Infinity, Infinity];
    for (const w of ws) {
      for (const p of m.wireRenders.get(w.id)?.path ?? []) {
        if (p[1] < best[1] || (p[1] === best[1] && p[0] < best[0])) best = [p[0], p[1]];
      }
    }
    return best;
  };

  const numbered: { node: NodeId; at: [number, number] }[] = [];
  const named = new Set<NodeId>();
  for (const [node, ws] of byNode) {
    if (namedRail(node) || mainCircuit(node) || namedByHand(ws)) named.add(node);
    else numbered.push({ node, at: anchor(ws) });
  }
  numbered.sort(
    (a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0] || (a.node < b.node ? -1 : a.node > b.node ? 1 : 0),
  );
  const numberOf = new Map<NodeId, string>();
  numbered.forEach((n, i) => numberOf.set(n.node, String(i + 1)));

  let changed = false;
  const next = wires.map((w) => {
    const node = m.terminalToNode.get(w.ends[0]);
    if (!node || !byNode.has(node)) return w;
    const want = numberOf.get(node);
    if (want !== undefined) {
      if (w.label === want) return w;
      changed = true;
      return { ...w, label: want };
    }
    // An unnumbered node: drop only a stale number, never a hand-written name.
    if (named.has(node) && isWireNumber(w.label)) {
      changed = true;
      const { label: _label, ...rest } = w;
      void _label;
      return rest;
    }
    return w;
  });

  return { diagram: changed ? { ...diagram, wires: next } : diagram, count: numbered.length };
}
