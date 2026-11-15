/**
 * Drop a symbol on a wire → it goes in line.
 *
 * Placing (or dragging) a device whose pins pair up into poles onto a
 * straight run of conductor cuts that conductor open and connects the pole
 * in series, the symbol turned to lie along the run. A multi-pole device
 * dropped across parallel phase conductors (L1 / L2 / L3 at the pole pitch)
 * goes into each of them. `planInsertOnWire` is the one resolution shared by
 * the commit and the place ghost / drag highlight, so the preview never lies.
 */

import type { InternalModel, ResolvedPlacement } from '../compiler/internal-model';
import { libraryById } from '../element-library';
import type { DiagramFile, Element, ElementId, LibraryEntry, Placement } from '../model';
import { useEditorStore } from '../store';
import { newPlacedElement } from '../store/id-allocator';
import { orientedRoute, polesOf, splitWiresForSeries, type Pole, type SeriesCut } from '../store/series';
import { snap } from './grid';
import { getScale } from './zoom-bus';

type Pt = [number, number];

/** Screen px from a wire within which a drop goes in line. Parallel phase
 *  conductors stay told apart: the nearest one wins. */
const INSERT_PX = 10;

/** `INSERT_PX` in world units at the current zoom. */
export function insertTol(): number {
  const s = getScale();
  return s > 0 ? INSERT_PX / s : INSERT_PX;
}

export interface InsertPlan {
  placement: Placement;
  cuts: SeriesCut[];
  /** The full routes of the conductors being cut, for the hover preview. */
  hosts: Pt[][];
}

interface Run {
  wireId: string;
  segment: number;
  /** 'v' = x constant. */
  axis: 'v' | 'h';
  /** The constant coordinate. */
  cross: number;
  lo: number;
  hi: number;
  /** True when `segment` runs toward decreasing along-coordinate. */
  reversed: boolean;
}

function runsOf(d: DiagramFile, m: InternalModel, skip?: (wireEnd: string) => boolean): Run[] {
  const runs: Run[] = [];
  for (const w of d.wires ?? []) {
    if (skip && (skip(w.ends[0]) || skip(w.ends[1]))) continue;
    const route = orientedRoute(w, m);
    for (let i = 0; i < route.length - 1; i++) {
      const [ax, ay] = route[i];
      const [bx, by] = route[i + 1];
      if (ax === bx && ay !== by) {
        runs.push({ wireId: w.id, segment: i, axis: 'v', cross: ax, lo: Math.min(ay, by), hi: Math.max(ay, by), reversed: by < ay });
      } else if (ay === by && ax !== bx) {
        runs.push({ wireId: w.id, segment: i, axis: 'h', cross: ay, lo: Math.min(ax, bx), hi: Math.max(ax, bx), reversed: bx < ax });
      }
    }
  }
  return runs;
}

function distToRun(r: Run, p: Pt): number {
  const along = r.axis === 'v' ? p[1] : p[0];
  const cross = r.axis === 'v' ? p[0] : p[1];
  const clamped = Math.max(r.lo, Math.min(r.hi, along));
  return Math.hypot(cross - r.cross, along - clamped);
}

/** Rotations tried for a run, preferred first: as drawn, then turned so a
 *  vertical symbol's top pin leads a horizontal run from the left. */
const ROTS: Record<'v' | 'h', ResolvedPlacement['rot'][]> = {
  v: [0, 90],
  h: [0, 270],
};

/**
 * Where a drop of `lib` at `cursor` goes in line, or null when it doesn't
 * land on a conductor it can take (no poles, a run too short for the
 * symbol, nothing within `tol`). `skip` hides wires touching some ends —
 * a device being dragged must not count its own conductors.
 */
export function planInsertOnWire(
  lib: LibraryEntry | undefined,
  cursor: Pt,
  tol = insertTol(),
  opts: { skip?: (end: string) => boolean; scale?: number } = {},
): InsertPlan | null {
  if (!lib || lib.stretchable || lib.terminals.length < 2) return null;
  const { diagram: d, internal: m } = useEditorStore.getState();
  const runs = runsOf(d, m, opts.skip);
  let near: Run | null = null;
  let nearD = tol;
  for (const r of runs) {
    const dist = distToRun(r, cursor);
    if (dist <= nearD) {
      nearD = dist;
      near = r;
    }
  }
  if (!near) return null;
  const host = near;
  const c = host.axis === 'v' ? 0 : 1; // cross index
  const a = 1 - c; // along index

  for (const rot of ROTS[host.axis]) {
    const frame: ResolvedPlacement = { at: [0, 0], rot, mirror: false, ...(opts.scale ? { scale: opts.scale } : {}) };
    const poles = polesOf(lib, frame).filter((p) => p.axis === host.axis);
    if (poles.length === 0) continue;

    let best: { score: number; off: Pt; hits: { pole: Pole; run: Run }[]; lean: number } | null = null;
    for (const k of poles) {
      const off: Pt = [0, 0];
      off[c] = host.cross - k.a.at[c];
      off[a] = snap(cursor[a] - (k.a.at[a] + k.b.at[a]) / 2);
      // Slide along the run (on the grid) rather than refuse a drop that
      // overhangs one end of it.
      const minOff = host.lo - k.a.at[a];
      const maxOff = host.hi - k.b.at[a];
      if (off[a] <= minOff) off[a] = Math.floor(minOff / 10) * 10 + 10;
      if (off[a] >= maxOff) off[a] = Math.ceil(maxOff / 10) * 10 - 10;
      const hits: { pole: Pole; run: Run }[] = [];
      const taken = new Set<string>();
      let fits = true;
      for (const p of poles) {
        const crossW = off[c] + p.a.at[c];
        const lo = off[a] + p.a.at[a];
        const hi = off[a] + p.b.at[a];
        const run = (p === k ? [host] : runs).find(
          (r) =>
            r.axis === host.axis &&
            !taken.has(r.wireId) &&
            Math.abs(r.cross - crossW) < 0.5 &&
            r.lo < lo &&
            hi < r.hi,
        );
        if (p === k && !run) {
          fits = false;
          break;
        }
        if (run) {
          taken.add(run.wireId);
          hits.push({ pole: p, run });
        }
      }
      if (!fits) continue;
      const centre = off[c] + poles.reduce((s, p) => s + p.a.at[c], 0) / poles.length;
      const lean = Math.abs(centre - cursor[c]);
      if (!best || hits.length > best.score || (hits.length === best.score && lean < best.lean)) {
        best = { score: hits.length, off, hits, lean };
      }
    }
    if (!best) continue;
    const chosen = best;

    const cuts: SeriesCut[] = chosen.hits.map(({ pole, run }) => {
      const pa: Pt = [chosen.off[0] + pole.a.at[0], chosen.off[1] + pole.a.at[1]];
      const pb: Pt = [chosen.off[0] + pole.b.at[0], chosen.off[1] + pole.b.at[1]];
      // Pole pin `a` is the low-coordinate one; the route segment runs
      // high→low when reversed, so `b` then meets the start side first.
      const [toStart, toEnd] = run.reversed
        ? [{ id: pole.b.id, at: pb }, { id: pole.a.id, at: pa }]
        : [{ id: pole.a.id, at: pa }, { id: pole.b.id, at: pb }];
      return { wireId: run.wireId, segment: run.segment, pinToStart: toStart, pinToEnd: toEnd };
    });
    const hosts = cuts.map((cut) => {
      const w = d.wires?.find((x) => x.id === cut.wireId);
      return w ? orientedRoute(w, m) : [];
    });
    return {
      placement: {
        at: chosen.off,
        ...(rot ? { rot } : {}),
        ...(opts.scale && opts.scale !== 1 ? { scale: opts.scale } : {}),
      },
      cuts,
      hosts,
    };
  }
  return null;
}

/**
 * The document with `elementId` laid out per `plan` and every cut conductor
 * split around it. Devices at the cut wires' far ends that auto-layout
 * placed are pinned where they render first: the topology changes, and the
 * neighbours must not jump away from the symbol just lined up with them.
 */
export function applyInsert(
  d: DiagramFile,
  m: InternalModel,
  elementId: ElementId,
  plan: InsertPlan,
): DiagramFile {
  const layout = { ...(d.layout ?? {}), [elementId]: plan.placement };
  for (const cut of plan.cuts) {
    const w = d.wires?.find((x) => x.id === cut.wireId);
    for (const end of w?.ends ?? []) {
      const dot = end.indexOf('.');
      if (dot < 0) continue;
      const owner = end.slice(0, dot);
      if (layout[owner]) continue;
      const rp = m.layout.get(owner);
      if (rp) {
        layout[owner] = {
          at: [rp.at[0], rp.at[1]],
          ...(rp.rot ? { rot: rp.rot } : {}),
          ...(rp.mirror ? { mirror: true } : {}),
          ...(rp.scale && rp.scale !== 1 ? { scale: rp.scale } : {}),
        };
      }
    }
  }
  return splitWiresForSeries({ ...d, layout }, m, elementId, plan.cuts);
}

/** Place a new `kind` in line per `plan`, in one undo step. */
export function dropElementInLine(kind: string, plan: InsertPlan): ElementId {
  const store = useEditorStore.getState();
  const { id, name } = newPlacedElement(store.diagram, kind);
  const m = store.internal;
  store.dispatch((d) => {
    const el: Element = { id, kind, ...(name ? { name } : {}) };
    return applyInsert({ ...d, elements: [...d.elements, el] }, m, id, plan);
  });
  store.setSelection([id]);
  return id;
}

/** Library entry for a kind, the document's own kinds included. */
export function libFor(kind: string): LibraryEntry | undefined {
  return useEditorStore.getState().internal.library.get(kind) ?? libraryById[kind];
}

// ---- Drag preview -------------------------------------------------------
// The select tool's drag runs outside React; it publishes the plan for the
// device under the pointer here and `InsertPreview` draws it.

type Listener = (plan: InsertPlan | null) => void;
let preview: InsertPlan | null = null;
const listeners = new Set<Listener>();

export function publishInsertPreview(plan: InsertPlan | null): void {
  if (plan === preview) return;
  preview = plan;
  for (const l of listeners) l(plan);
}

export function getInsertPreview(): InsertPlan | null {
  return preview;
}

export function subscribeInsertPreview(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
