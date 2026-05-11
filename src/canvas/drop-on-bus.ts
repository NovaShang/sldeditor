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
import { newElementId, useEditorStore, wireIdFromEnds } from '../store';
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
    const cursorPin = pickPlaceCursorTerminal(lib);
    const placedAt: [number, number] = cursorPin
      ? [snap(at[0]) - cursorPin.x, snap(at[1]) - cursorPin.y]
      : [snap(at[0]), snap(at[1])];
    const id = store.addElement(kind, placedAt);
    return { newElementId: id, attachedToBus: false };
  }

  const { busId, busAt, axis } = target;
  const tapPin = pickTapTerminal(lib, axis);
  const newId = newElementId(diagram, kind);

  const tapLocal = lib.terminals.find((t) => t.id === tapPin);
  const dropX = axis === 'x' ? at[0] : busAt[0];
  const dropY = axis === 'y' ? at[1] : busAt[1];
  const placedAt: [number, number] = tapLocal
    ? [snap(dropX) - tapLocal.x, snap(dropY) - tapLocal.y]
    : [snap(at[0]), snap(at[1])];

  store.dispatch((d) => {
    const newElement: Element = { id: newId, kind };
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

/**
 * Pick which terminal of the new element should connect to the source.
 * Prefer a terminal whose orientation is opposite to the source's (so the
 * body extends naturally *away* from the source). Tie-break by world
 * distance to source.
 */
export function pickConnectTerminal(
  lib: LibraryEntry,
  source: PlaceSource,
  placeAt: [number, number],
): LibraryTerminal {
  if (lib.terminals.length === 0) {
    return { id: 't', x: 0, y: 0, orientation: 'n' };
  }
  const wantOrient = OPPOSITE[source.orientation];
  const opposites = lib.terminals.filter((t) => t.orientation === wantOrient);
  const pool = opposites.length > 0 ? opposites : lib.terminals;
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
 * Place a new element with one of its terminals connected to `sourceRef` in
 * a single undo step.
 */
export function dropElementFromTerminal(
  kind: string,
  sourceRef: WireEnd,
  cursorAt: [number, number],
): DropResult | null {
  const lib = libraryById[kind];
  const store = useEditorStore.getState();
  const diagram = store.diagram;
  if (!lib) return null;

  const source = resolvePlaceSource(sourceRef, cursorAt);
  if (!source) return null;

  const dx = cursorAt[0] - source.world[0];
  const dy = cursorAt[1] - source.world[1];
  const treatAsClick = dx * dx + dy * dy <= CLICK_SLOP_SQ;
  const cursorPlaceAt: [number, number] = [snap(cursorAt[0]), snap(cursorAt[1])];
  const chosen = pickConnectTerminal(lib, source, cursorPlaceAt);
  const placedAt: [number, number] = treatAsClick
    ? [snap(source.world[0] - chosen.x), snap(source.world[1] - chosen.y)]
    : cursorPlaceAt;
  const newId = newElementId(diagram, kind);

  store.dispatch((d) => {
    const newElement: Element = { id: newId, kind };
    const placement: Placement = { at: placedAt };
    const newPinRef = `${newId}.${chosen.id}` as TerminalRef;
    const tieEnd: WireEnd = source.isBus && source.busId ? source.busId : sourceRef;
    const wire: Wire = {
      id: wireIdFromEnds(tieEnd, newPinRef),
      ends: [tieEnd, newPinRef],
    };
    return {
      ...d,
      elements: [...d.elements, newElement],
      wires: [...(d.wires ?? []), wire],
      layout: { ...(d.layout ?? {}), [newId]: placement },
    };
  });

  store.setSelection([newId]);
  return { newElementId: newId, attachedToBus: source.isBus };
}
