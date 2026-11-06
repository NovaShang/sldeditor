/**
 * Drop / place near-a-bus auto-tap helper. When the user drops a palette item
 * within reach of an existing bus, attach the new element's "tap-side"
 * terminal to that bus via a `Wire` — instead of just dropping the element
 * in free space.
 *
 * Tap-side picking: the element's terminal closest to the bus axis (smallest
 * |y - bus.y| in canvas coords for horizontal buses), so the body extends
 * away from the bus naturally.
 */

import { libraryById } from '../element-library';
import type {
  BusId,
  DiagramFile,
  Element,
  ElementId,
  LibraryEntry,
  LibraryTerminal,
  Orientation,
  Placement,
  TerminalRef,
  Wire,
  WireEnd,
} from '../model';
import type { TerminalGeometry } from '../compiler/internal-model';
import { useEditorStore, wireIdFromEnds } from '../store';
import { newPlacedElement } from '../store/id-allocator';
import { snap } from './grid';

const PROXIMITY_PX = 30;
const CLICK_SLOP_SQ = 12 * 12;

export interface DropResult {
  newElementId: ElementId;
  attachedToBus: boolean;
}

export function dropElement(kind: string, at: [number, number]): DropResult {
  const lib = libraryById[kind];
  const store = useEditorStore.getState();
  const diagram = store.diagram;

  // Busbar drops are handled by BusbarTool directly. Bus-on-bus = nonsense.
  if (!lib || kind === 'busbar') {
    const id = store.addElement(kind, at);
    return { newElementId: id, attachedToBus: false };
  }

  const target = nearestBus(diagram, at);
  if (!target) {
    const id = store.addElement(kind, freePlacementAt(lib, at));
    return { newElementId: id, attachedToBus: false };
  }

  const { busId, busAt, axis } = target;
  const tapPin = pickTapTerminal(lib, axis);
  const { id: newId, name } = newPlacedElement(diagram, kind);

  const tapLocal = lib.terminals.find((t) => t.id === tapPin);
  const dropX = axis === 'x' ? at[0] : busAt[0];
  const dropY = axis === 'y' ? at[1] : busAt[1];
  const placedAt: [number, number] = tapLocal
    ? [snap(dropX) - tapLocal.x, snap(dropY) - tapLocal.y]
    : [snap(at[0]), snap(at[1])];

  store.dispatch((d) => {
    const newElement: Element = { id: newId, kind, ...(name ? { name } : {}) };
    const placement: Placement = { at: placedAt };
    const newEnd = `${newId}.${tapPin}` as TerminalRef;
    const wire: Wire = {
      id: wireIdFromEnds(busId, newEnd),
      ends: [busId, newEnd],
    };
    return {
      ...d,
      elements: [...d.elements, newElement],
      wires: [...(d.wires ?? []), wire],
      layout: { ...(d.layout ?? {}), [newId]: placement },
    };
  });

  store.setSelection([newId]);
  return { newElementId: newId, attachedToBus: true };
}

interface NearestBus {
  busId: BusId;
  busAt: [number, number];
  axis: 'x' | 'y';
}

function nearestBus(d: DiagramFile, at: [number, number]): NearestBus | null {
  const internal = useEditorStore.getState().internal;
  let best: NearestBus & { dist: number } | null = null;
  for (const bus of d.buses ?? []) {
    const rb = internal.buses.get(bus.id);
    if (!rb) continue;
    const { axis, at: busAt, span } = rb.geometry;
    let dist: number;
    if (axis === 'x') {
      const minX = busAt[0] - span / 2;
      const maxX = busAt[0] + span / 2;
      const dx = at[0] < minX ? minX - at[0] : at[0] > maxX ? at[0] - maxX : 0;
      const dy = Math.abs(at[1] - busAt[1]);
      dist = Math.sqrt(dx * dx + dy * dy);
    } else {
      const minY = busAt[1] - span / 2;
      const maxY = busAt[1] + span / 2;
      const dy = at[1] < minY ? minY - at[1] : at[1] > maxY ? at[1] - maxY : 0;
      const dx = Math.abs(at[0] - busAt[0]);
      dist = Math.sqrt(dx * dx + dy * dy);
    }
    if (dist <= PROXIMITY_PX && (!best || dist < best.dist)) {
      best = { busId: bus.id, busAt: [busAt[0], busAt[1]], axis, dist };
    }
  }
  if (!best) return null;
  return { busId: best.busId, busAt: best.busAt, axis: best.axis };
}

function pickTapTerminal(lib: LibraryEntry, busAxis: 'x' | 'y'): string {
  if (lib.terminals.length === 0) return 't';
  const sorted = [...lib.terminals].sort((a, b) =>
    busAxis === 'x' ? a.y - b.y : a.x - b.x,
  );
  return sorted[0].id;
}

/**
 * The library terminal that should sit at the cursor while a free placement
 * is in progress — same "tap-side" rule as `pickTapTerminal`, returned as a
 * full terminal so callers can offset placement (or the place ghost) so the
 * cursor visually holds that pin instead of the element's hotspot.
 *
 * Stretchable kinds don't have a meaningful tap; returns null and callers
 * use the element's hotspot.
 */
export function pickPlaceCursorTerminal(
  lib: LibraryEntry,
): LibraryTerminal | null {
  if (!lib || lib.stretchable || lib.terminals.length === 0) return null;
  const sorted = [...lib.terminals].sort((a, b) => a.y - b.y);
  return sorted[0];
}

/** World units above / below a multi-pole row searched for pins to line up with. */
const POLE_REACH = 200;

/**
 * Where a free (click / palette-drop) placement lands: the tap-side pin on
 * the snapped cursor, then `alignPolesToFacing`. Shared with the place ghost
 * so the preview and the result never disagree.
 */
export function freePlacementAt(lib: LibraryEntry, at: [number, number]): [number, number] {
  const cursorPin = pickPlaceCursorTerminal(lib);
  const placedAt: [number, number] = cursorPin
    ? [snap(at[0]) - cursorPin.x, snap(at[1]) - cursorPin.y]
    : [snap(at[0]), snap(at[1])];
  return alignPolesToFacing(lib, placedAt);
}

/**
 * Pole-for-pole magnet for a free placement of a multi-pole device. The cursor
 * carries pole 1, but people aim a 3-pole contactor by its middle, so it used
 * to land one pole off the breaker above it and every phase needed a jog.
 *
 * For each row of two or more pins facing up (or down), look for facing
 * pins of existing devices above (below) within `POLE_REACH`, and shift the
 * placement sideways — by at most one pole pitch — to the offset where the
 * most poles line up. Applied only when at least two do, so single-pole
 * devices (every single-line diagram symbol) place exactly as before.
 */
export function alignPolesToFacing(
  lib: LibraryEntry,
  at: [number, number],
): [number, number] {
  if (lib.stretchable) return at;
  const terminals = [...useEditorStore.getState().internal.terminals.values()];
  let best = { shift: 0, score: 0 };
  for (const o of ['n', 's'] as const) {
    const row = lib.terminals.filter((t) => t.orientation === o);
    if (row.length < 2) continue;
    const xs = row.map((t) => t.x).sort((a, b) => a - b);
    let pitch = Infinity;
    for (let i = 1; i < xs.length; i++) if (xs[i] > xs[i - 1]) pitch = Math.min(pitch, xs[i] - xs[i - 1]);
    if (!Number.isFinite(pitch)) continue;
    // Facing pins per row pin: the other way round, on the side it opens to.
    const facing = row.map((t) => {
      const y = at[1] + t.y;
      return terminals.filter((g) => {
        if (g.orientation !== OPPOSITE[o]) return false;
        const gap = o === 'n' ? y - g.world[1] : g.world[1] - y;
        return gap >= 0 && gap <= POLE_REACH;
      });
    });
    const shifts = new Set<number>();
    row.forEach((t, i) => {
      for (const g of facing[i]) {
        const d = g.world[0] - (at[0] + t.x);
        if (Math.abs(d) <= pitch) shifts.add(d);
      }
    });
    for (const shift of shifts) {
      let score = 0;
      row.forEach((t, i) => {
        const x = at[0] + t.x + shift;
        if (facing[i].some((g) => Math.abs(g.world[0] - x) < 0.5)) score++;
      });
      if (
        score > best.score ||
        (score === best.score && Math.abs(shift) < Math.abs(best.shift))
      ) {
        best = { shift, score };
      }
    }
  }
  return best.score >= 2 ? [at[0] + best.shift, at[1]] : at;
}

/**
 * Resolved place-source: world coords + orientation of the terminal we're
 * dragging from. Handles both real device terminals and a bare bus id
 * (projected onto the bus axis at the cursor point, with orientation flipped
 * to point toward the drag side so the new element body extends away).
 */
export interface PlaceSource {
  ref: WireEnd;
  world: [number, number];
  orientation: Orientation;
  /** True iff `ref` is a bus id (bare, no dot). */
  isBus: boolean;
  /** Set when isBus. */
  busId?: BusId;
}

export function resolvePlaceSource(
  ref: WireEnd,
  cursorWorld: [number, number],
): PlaceSource | null {
  const internal = useEditorStore.getState().internal;
  if (!ref.includes('.') && internal.buses.has(ref)) {
    const rb = internal.buses.get(ref)!;
    const { axis, at, span } = rb.geometry;
    if (axis === 'x') {
      const minX = at[0] - span / 2;
      const maxX = at[0] + span / 2;
      const x = Math.max(minX, Math.min(maxX, cursorWorld[0]));
      const y = at[1];
      const orientation: Orientation = cursorWorld[1] >= y ? 's' : 'n';
      return { ref, world: [x, y], orientation, isBus: true, busId: ref };
    }
    const minY = at[1] - span / 2;
    const maxY = at[1] + span / 2;
    const y = Math.max(minY, Math.min(maxY, cursorWorld[1]));
    const x = at[0];
    const orientation: Orientation = cursorWorld[0] >= x ? 'e' : 'w';
    return { ref, world: [x, y], orientation, isBus: true, busId: ref };
  }
  if (!ref.includes('.') && internal.junctions.has(ref)) {
    // A junction is a bare point (no axis). Orient from the junction toward the
    // cursor so the new element's body extends away from it — mirroring the bus
    // case, which lets you drag a connected element out of a junction.
    const rj = internal.junctions.get(ref)!;
    const [jx, jy] = rj.world;
    const dx = cursorWorld[0] - jx;
    const dy = cursorWorld[1] - jy;
    const orientation: Orientation =
      Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'e' : 'w') : (dy >= 0 ? 's' : 'n');
    return { ref, world: [jx, jy], orientation, isBus: false };
  }
  const term = internal.terminals.get(ref as `${string}.${string}`);
  if (term) {
    return {
      ref,
      world: term.world,
      orientation: term.orientation,
      isBus: false,
    };
  }
  return null;
}

const OPPOSITE: Record<Orientation, Orientation> = {
  n: 's',
  s: 'n',
  e: 'w',
  w: 'e',
};

/** The coordinate a row of poles spreads along: across the exit direction. */
const ACROSS: Record<Orientation, 0 | 1> = { n: 0, s: 0, e: 1, w: 1 };

/** Library pins facing back toward a source exiting `o`, in row order. */
function facingRow(lib: LibraryEntry, o: Orientation): LibraryTerminal[] {
  const key = ACROSS[o] === 0 ? 'x' : 'y';
  return lib.terminals
    .filter((t) => t.orientation === OPPOSITE[o])
    .sort((a, b) => a[key] - b[key]);
}

/**
 * The source device's pins that exit the same way as the source pin, in row
 * order, and where the source pin sits among them: breaker pin 4 is pole 1 of
 * the outgoing row 2/4/6. Null for a bus or junction source.
 */
function sourcePoles(ref: WireEnd): { pins: TerminalGeometry[]; index: number } | null {
  if (!ref.includes('.')) return null;
  const m = useEditorStore.getState().internal;
  const term = m.terminals.get(ref as TerminalRef);
  if (!term) return null;
  const axis = ACROSS[term.orientation];
  const pins = (m.elementToTerminals.get(term.elementId) ?? [])
    .map((r) => m.terminals.get(r))
    .filter((t): t is TerminalGeometry => !!t && t.orientation === term.orientation)
    .sort((a, b) => a.world[axis] - b.world[axis]);
  return { pins, index: pins.findIndex((t) => t.ref === ref) };
}

/**
 * Pick which terminal of the new element should connect to the source.
 * Prefer a terminal whose orientation is opposite to the source's (so the
 * body extends naturally *away* from the source). With several of those
 * (a multi-pole device) and a `pole` index — the source pin's place in its
 * own row — take the same pole: breaker 2/4/6 feed contactor 1/3/5, not
 * whichever pole happens to sit nearest. Otherwise tie-break by world
 * distance to source.
 */
export function pickConnectTerminal(
  lib: LibraryEntry,
  source: PlaceSource,
  placeAt: [number, number],
  pole?: number,
): LibraryTerminal {
  if (lib.terminals.length === 0) {
    return { id: 't', x: 0, y: 0, orientation: 'n' };
  }
  const row = facingRow(lib, source.orientation);
  if (pole !== undefined && pole >= 0 && row.length > 1 && pole < row.length) {
    return row[pole];
  }
  const pool = row.length > 0 ? row : lib.terminals;
  let best = pool[0];
  let bestDist = termWorldDist(best, placeAt, source.world);
  for (let i = 1; i < pool.length; i++) {
    const t = pool[i];
    const d = termWorldDist(t, placeAt, source.world);
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return best;
}

function termWorldDist(
  t: LibraryTerminal,
  placeAt: [number, number],
  source: [number, number],
): number {
  const dx = placeAt[0] + t.x - source[0];
  const dy = placeAt[1] + t.y - source[1];
  return dx * dx + dy * dy;
}

/**
 * Which way a new element leaves a junction. A junction has no direction of
 * its own: a drag points the way the cursor went, but if the element has no
 * pin that can face back that way (a vertical contact dragged sideways) the
 * other axis is used. A tap takes the side no conductor uses yet — straight on
 * from a lone conductor if the element can, else downward, the way current
 * paths run. Picking the nearest pin regardless used to stand a contact on
 * its head at the end of a horizontal run.
 */
function junctionExit(
  lib: LibraryEntry,
  jid: WireEnd,
  world: [number, number],
  cursor: [number, number],
  click: boolean,
): Orientation {
  const canFace = (o: Orientation) => lib.terminals.some((t) => t.orientation === OPPOSITE[o]);
  const dx = cursor[0] - world[0];
  const dy = cursor[1] - world[1];
  if (!click) {
    const primary: Orientation =
      Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'e' : 'w') : (dy >= 0 ? 's' : 'n');
    if (canFace(primary)) return primary;
    const secondary: Orientation =
      ACROSS[primary] === 1 ? (dy >= 0 ? 's' : 'n') : (dx >= 0 ? 'e' : 'w');
    return canFace(secondary) ? secondary : primary;
  }
  const used = junctionWireDirs(jid, world);
  const order: Orientation[] = used.size === 1 ? [OPPOSITE[[...used][0]]] : [];
  order.push('s', 'e', 'w', 'n');
  return (
    order.find((o) => !used.has(o) && canFace(o)) ??
    order.find(canFace) ??
    's'
  );
}

/** Directions the conductors at a junction leave it in, from their routes. */
function junctionWireDirs(jid: WireEnd, world: [number, number]): Set<Orientation> {
  const { diagram, internal } = useEditorStore.getState();
  const dirs = new Set<Orientation>();
  for (const w of diagram.wires ?? []) {
    if (w.ends[0] !== jid && w.ends[1] !== jid) continue;
    const path = internal.wireRenders.get(w.id)?.path ?? [];
    const pts = w.ends[0] === jid ? path : [...path].reverse();
    const next = pts.find((p) => p[0] !== world[0] || p[1] !== world[1]);
    if (!next) continue;
    const dx = next[0] - world[0];
    const dy = next[1] - world[1];
    dirs.add(Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'e' : 'w') : (dy >= 0 ? 's' : 'n'));
  }
  return dirs;
}

/** One conductor a place-from-terminal commits. */
export interface PlaceLink {
  from: WireEnd;
  fromWorld: [number, number];
  /** Pin id on the new element. */
  pin: string;
  pinWorld: [number, number];
}

export interface PlacePlan {
  source: PlaceSource;
  placedAt: [number, number];
  /** The pressed source's link first, then any further poles wired with it. */
  links: PlaceLink[];
}

/**
 * Everything a place-from-terminal gesture resolves to — where the element
 * lands and which conductors it gets — for the commit and the ghost alike.
 *
 * Single-pole: the chosen pin lands at the anchor, `source.world` for a tap
 * (so the pin meets the source terminal) or the cursor for a drag (so the
 * visible ghost, which carries the chosen pin, matches where the element
 * lands).
 *
 * Multi-pole (either side has a row of poles): the pole matching the source
 * pin is chosen, and the element is lined up on the source pin's column so
 * the conductor runs straight — exactly, not to the grid, unless the drag
 * goes off sideways. Every further source pole that then lines up with a pole
 * of the new element and isn't wired yet is wired too: one drag from breaker
 * pin 2 connects 2-1, 4-3 and 6-5.
 */
export function planPlaceFromTerminal(
  lib: LibraryEntry,
  sourceRef: WireEnd,
  cursorAt: [number, number],
): PlacePlan | null {
  const resolved = resolvePlaceSource(sourceRef, cursorAt);
  if (!resolved) return null;

  const dx = cursorAt[0] - resolved.world[0];
  const dy = cursorAt[1] - resolved.world[1];
  const treatAsClick = dx * dx + dy * dy <= CLICK_SLOP_SQ;
  const isJunction = !resolved.isBus && !sourceRef.includes('.');
  const source: PlaceSource = isJunction
    ? {
        ...resolved,
        orientation: junctionExit(lib, sourceRef, resolved.world, cursorAt, treatAsClick),
      }
    : resolved;

  const cursorPlaceAt: [number, number] = [snap(cursorAt[0]), snap(cursorAt[1])];
  const poles = sourcePoles(sourceRef);
  const chosen = pickConnectTerminal(lib, source, cursorPlaceAt, poles?.index);
  const anchor = treatAsClick ? source.world : cursorPlaceAt;
  const placedAt: [number, number] = [
    snap(anchor[0] - chosen.x),
    snap(anchor[1] - chosen.y),
  ];

  const row = facingRow(lib, source.orientation);
  const axis = ACROSS[source.orientation];
  const key = axis === 0 ? 'x' : 'y';
  const multiPole = poles !== null && (row.length > 1 || poles.pins.length > 1);
  const drift = Math.abs(cursorAt[axis] - source.world[axis]);
  const reach = Math.abs(cursorAt[1 - axis] - source.world[1 - axis]);
  if (multiPole && (treatAsClick || drift <= reach)) {
    placedAt[axis] = source.world[axis] - chosen[key];
  }

  const pinWorld = (t: LibraryTerminal): [number, number] => [
    placedAt[0] + t.x,
    placedAt[1] + t.y,
  ];
  const tieEnd: WireEnd = source.isBus && source.busId ? source.busId : sourceRef;
  const links: PlaceLink[] = [
    { from: tieEnd, fromWorld: source.world, pin: chosen.id, pinWorld: pinWorld(chosen) },
  ];

  const at = row.indexOf(chosen);
  if (poles && poles.pins.length > 1 && row.length > 1 && at >= 0) {
    const wired = new Set<WireEnd>();
    for (const w of useEditorStore.getState().diagram.wires ?? []) {
      wired.add(w.ends[0]);
      wired.add(w.ends[1]);
    }
    poles.pins.forEach((s, j) => {
      if (j === poles.index || wired.has(s.ref)) return;
      const t = row[at + j - poles.index];
      if (!t) return;
      // Same pole pitch on both sides (a scaled symbol doesn't match).
      const p = pinWorld(t);
      const along = p[axis] - links[0].pinWorld[axis];
      if (Math.abs(along - (s.world[axis] - source.world[axis])) > 0.5) return;
      links.push({ from: s.ref, fromWorld: s.world, pin: t.id, pinWorld: p });
    });
  }
  return { source, placedAt, links };
}

/**
 * Place a new element connected to `sourceRef` — one conductor, or one per
 * matching pole (see `planPlaceFromTerminal`) — in a single undo step.
 */
export function dropElementFromTerminal(
  kind: string,
  sourceRef: WireEnd,
  cursorAt: [number, number],
): DropResult | null {
  const store = useEditorStore.getState();
  const lib = store.internal.library.get(kind) ?? libraryById[kind];
  const diagram = store.diagram;
  if (!lib) return null;

  const plan = planPlaceFromTerminal(lib, sourceRef, cursorAt);
  if (!plan) return null;
  const { id: newId, name } = newPlacedElement(diagram, kind);

  store.dispatch((d) => {
    const newElement: Element = { id: newId, kind, ...(name ? { name } : {}) };
    const placement: Placement = { at: plan.placedAt };
    const wires: Wire[] = plan.links.map((l) => {
      const newPinRef = `${newId}.${l.pin}` as TerminalRef;
      return { id: wireIdFromEnds(l.from, newPinRef), ends: [l.from, newPinRef] };
    });
    return {
      ...d,
      elements: [...d.elements, newElement],
      wires: [...(d.wires ?? []), ...wires],
      layout: { ...(d.layout ?? {}), [newId]: placement },
    };
  });

  store.setSelection([newId]);
  return { newElementId: newId, attachedToBus: plan.source.isBus };
}
