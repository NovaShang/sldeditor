/**
 * Devices in series on a conductor — the model side of "drop a symbol on a
 * wire and it goes in line" and its inverse, "delete it and the wire closes
 * back up".
 *
 * A device sits in series through a *pole*: two pins that face opposite ways
 * along one line (a contact's 13 / 14, a contactor's 1 / 2, 3 / 4, 5 / 6).
 * Everything here works pole by pole, so a three-pole device inserts into
 * three phase conductors and heals three of them back.
 */

import { routeWire } from '../compiler/auto-route';
import { transformOrientation, transformPoint } from '../compiler/transforms';
import type { InternalModel, ResolvedPlacement } from '../compiler/internal-model';
import type {
  DiagramFile,
  ElementId,
  LibraryEntry,
  Orientation,
  TerminalRef,
  Wire,
  WireEnd,
} from '../model';
import { normalizePath } from '../model/wire-path';
import { wireIdFromEnds } from './id-allocator';

type Pt = [number, number];

/** One pole of a placed (or about-to-be-placed) symbol, in placement frame. */
export interface Pole {
  /** Pin facing up (vertical pole) or left (horizontal pole). */
  a: { id: string; at: Pt };
  /** Pin facing down / right. */
  b: { id: string; at: Pt };
  /** 'v' when the pole runs vertically (n / s pins), 'h' for w / e. */
  axis: 'v' | 'h';
}

const EPS = 0.5;

/**
 * The poles of `lib` under `placement` (origin included, so `at` are world
 * coords when the placement's `at` is). With `aligned`, a pole's two pins
 * must sit on one line — what inserting into a straight run needs; without
 * it a lone opposite-facing pair still counts (healing doesn't care where
 * the pins are, only that current goes in one and out the other).
 */
export function polesOf(
  lib: LibraryEntry,
  placement: ResolvedPlacement,
  aligned = true,
): Pole[] {
  if (lib.stretchable) return [];
  const pins = lib.terminals.map((t) => ({
    id: t.id,
    at: transformPoint([t.x, t.y], placement),
    o: transformOrientation(t.orientation, placement),
  }));
  const poles: Pole[] = [];
  const used = new Set<string>();
  const pairUp = (first: Orientation, second: Orientation, axis: 'v' | 'h') => {
    const cross = axis === 'v' ? 0 : 1;
    const along = 1 - cross;
    for (const p of pins) {
      if (p.o !== first || used.has(p.id)) continue;
      // Nearest opposite-facing pin on the same line, on the far side.
      let best: (typeof pins)[number] | null = null;
      for (const q of pins) {
        if (q.o !== second || used.has(q.id)) continue;
        if (Math.abs(q.at[cross] - p.at[cross]) > EPS) continue;
        if (q.at[along] <= p.at[along]) continue;
        if (!best || q.at[along] < best.at[along]) best = q;
      }
      if (!best) continue;
      used.add(p.id);
      used.add(best.id);
      poles.push({ a: { id: p.id, at: p.at }, b: { id: best.id, at: best.at }, axis });
    }
  };
  pairUp('n', 's', 'v');
  pairUp('w', 'e', 'h');
  if (poles.length === 0 && !aligned && pins.length === 2) {
    const [p, q] = pins;
    if (OPPOSITE[p.o] === q.o) {
      const axis = p.o === 'n' || p.o === 's' ? 'v' : 'h';
      const pFirst = p.o === 'n' || p.o === 'w';
      const [a, b] = pFirst ? [p, q] : [q, p];
      poles.push({ a: { id: a.id, at: a.at }, b: { id: b.id, at: b.at }, axis });
    }
  }
  poles.sort((x, y) => {
    const c = x.axis === 'v' ? 0 : 1;
    return x.a.at[c] - y.a.at[c];
  });
  return poles;
}

const OPPOSITE: Record<Orientation, Orientation> = { n: 's', s: 'n', e: 'w', w: 'e' };

/** World point of a non-bus wire end (pin / junction), or null. */
function pointOf(end: WireEnd, m: InternalModel): Pt | null {
  if (!end.includes('.')) {
    const j = m.junctions.get(end);
    return j ? [j.world[0], j.world[1]] : null;
  }
  const t = m.terminals.get(end as TerminalRef);
  return t ? [t.world[0], t.world[1]] : null;
}

/**
 * A wire's rendered route ordered from `ends[0]` to `ends[1]`. Bus ends are
 * routed from the other end, so the stored polyline can run either way.
 */
export function orientedRoute(wire: Wire, m: InternalModel): Pt[] {
  const path = (m.wireRenders.get(wire.id)?.path ?? []).map((p) => [p[0], p[1]] as Pt);
  if (path.length < 2) return path;
  const d = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const first = pointOf(wire.ends[0], m);
  if (first) return d(path[0], first) <= d(path[path.length - 1], first) ? path : path.reverse();
  const last = pointOf(wire.ends[1], m);
  if (last) return d(path[path.length - 1], last) <= d(path[0], last) ? path : path.reverse();
  return path;
}

/** Keep the decoration a conductor carries (phase label, colour). */
function decoration(w: Wire | undefined): Pick<Wire, 'label' | 'color'> {
  return {
    ...(w?.label ? { label: w.label } : {}),
    ...(w?.color ? { color: w.color } : {}),
  };
}

/** One host conductor cut open to take one pole. */
export interface SeriesCut {
  wireId: string;
  /** Index of the route segment (in `orientedRoute` order) the pole sits on. */
  segment: number;
  /** Pin that faces `ends[0]` of the host, and its world point. */
  pinToStart: { id: string; at: Pt };
  /** Pin that faces `ends[1]`. */
  pinToEnd: { id: string; at: Pt };
}

/**
 * Split every cut wire around `elementId`'s pole: `[a, b]` becomes
 * `[a, X.p]` + `[X.q, b]`, both keeping the host's label and colour. A host
 * with a hand-drawn route keeps its shape (the route is cut at the pins);
 * an auto-routed one stays auto-routed — the router draws the same line.
 */
export function splitWiresForSeries(
  d: DiagramFile,
  m: InternalModel,
  elementId: ElementId,
  cuts: SeriesCut[],
): DiagramFile {
  const byId = new Map((d.wires ?? []).map((w) => [w.id, w]));
  const removed = new Set<string>();
  const added: Wire[] = [];
  for (const cut of cuts) {
    const host = byId.get(cut.wireId);
    if (!host) continue;
    removed.add(host.id);
    const route = host.path ? orientedRoute(host, m) : [];
    const pStart = `${elementId}.${cut.pinToStart.id}` as TerminalRef;
    const pEnd = `${elementId}.${cut.pinToEnd.id}` as TerminalRef;
    const half = (a: WireEnd, b: WireEnd, path?: Pt[]): Wire => {
      const cleaned = path ? normalizePath(path) : null;
      return {
        id: wireIdFromEnds(a, b),
        ends: [a, b],
        ...(cleaned && cleaned.length > 2 ? { path: cleaned } : {}),
        ...decoration(host),
      };
    };
    const i = cut.segment;
    added.push(
      half(
        host.ends[0],
        pStart,
        route.length ? [...route.slice(0, i + 1), cut.pinToStart.at] : undefined,
      ),
      half(pEnd, host.ends[1], route.length ? [cut.pinToEnd.at, ...route.slice(i + 1)] : undefined),
    );
  }
  const kept = (d.wires ?? []).filter((w) => !removed.has(w.id));
  const ids = new Set(kept.map((w) => w.id));
  for (const w of added) {
    if (ids.has(w.id)) continue;
    ids.add(w.id);
    kept.push(w);
  }
  return { ...d, wires: kept.length ? kept : undefined };
}

/**
 * Close the conductors back up through every pole of the devices being
 * deleted. A pole heals when each of its pins carries exactly one wire and
 * both far ends survive the delete (and are not the same point): the two
 * wires become one, keeping the label / colour and — when the router would
 * draw it differently — the route the two halves made. Returns the wires to
 * add; the caller removes the deleted devices' wires as usual.
 */
export function healSeries(
  d: DiagramFile,
  m: InternalModel,
  deleted: ReadonlySet<string>,
): Wire[] {
  const wires = d.wires ?? [];
  const owner = (end: WireEnd) => {
    const dot = end.indexOf('.');
    return dot < 0 ? end : end.slice(0, dot);
  };
  const at = new Map<WireEnd, Wire[]>();
  for (const w of wires) {
    for (const e of w.ends) {
      const list = at.get(e);
      if (list) list.push(w);
      else at.set(e, [w]);
    }
  }
  const out: Wire[] = [];
  const ids = new Set(wires.map((w) => w.id));
  for (const el of d.elements) {
    if (!deleted.has(el.id)) continue;
    const lib = m.library.get(el.kind);
    const placement = m.layout.get(el.id);
    if (!lib || !placement) continue;
    for (const pole of polesOf(lib, placement, false)) {
      const refA = `${el.id}.${pole.a.id}` as TerminalRef;
      const refB = `${el.id}.${pole.b.id}` as TerminalRef;
      const wa = at.get(refA);
      const wb = at.get(refB);
      if (wa?.length !== 1 || wb?.length !== 1 || wa[0] === wb[0]) continue;
      const farA = wa[0].ends[0] === refA ? wa[0].ends[1] : wa[0].ends[0];
      const farB = wb[0].ends[0] === refB ? wb[0].ends[1] : wb[0].ends[0];
      if (farA === farB || deleted.has(owner(farA)) || deleted.has(owner(farB))) continue;
      const id = wireIdFromEnds(farA, farB);
      if (ids.has(id)) continue;
      ids.add(id);
      // farA → refA, then refB → farB: the line the two halves drew.
      const routeA = orientedRoute(wa[0], m);
      const toA = wa[0].ends[0] === farA ? routeA : [...routeA].reverse();
      const routeB = orientedRoute(wb[0], m);
      const fromB = wb[0].ends[0] === refB ? routeB : [...routeB].reverse();
      const joined = normalizePath([...toA, ...fromB]);
      const healed: Wire = {
        id,
        ends: [farA, farB],
        ...decoration(wa[0].label || wa[0].color ? wa[0] : wb[0]),
      };
      const auto = routeWire(healed, m)?.path;
      const straight = pole.a.at[pole.axis === 'v' ? 0 : 1] === pole.b.at[pole.axis === 'v' ? 0 : 1];
      if (straight && joined.length >= 2 && !samePath(auto ?? [], joined)) {
        healed.path = joined;
      }
      out.push(healed);
    }
  }
  return out;
}

function samePath(a: Pt[], b: Pt[]): boolean {
  const na = normalizePath(a);
  const nb = normalizePath(b);
  const rb = [...nb].reverse();
  const eq = (x: Pt[], y: Pt[]) =>
    x.length === y.length && x.every((p, i) => Math.abs(p[0] - y[i][0]) < EPS && Math.abs(p[1] - y[i][1]) < EPS);
  return eq(na, nb) || eq(na, rb);
}
