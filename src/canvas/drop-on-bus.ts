/**
 * Drop / place near-a-bus auto-tap helper. When the user drops a palette item
 * within reach of an existing busbar, attach the new element's "tap-side"
 * terminal to that bus via `Element.tap` sugar — instead of just dropping
 * the element in free space.
 *
 * Tap-side picking: the element's terminal closest to the bus axis (smallest
 * |y - bus.y| in canvas coords for horizontal buses), so the body extends
 * away from the bus naturally.
 */

import { libraryById } from '../element-library';
import type {
  DiagramFile,
  Element,
  ElementId,
  LibraryEntry,
  LibraryTerminal,
  Orientation,
  Placement,
  TerminalRef,
} from '../model';
import { newElementId } from '../store';
import { useEditorStore } from '../store';
import { snap } from './grid';

const PROXIMITY_PX = 30;
/** Below this squared distance from the source terminal, a place-from-terminal
 *  release is treated as a "click" — the new element snaps so its chosen pin
 *  lands on the source instead of following the cursor. */
const CLICK_SLOP_SQ = 12 * 12;

export interface DropResult {
  newElementId: ElementId;
  attachedToBus: boolean;
}

export function dropElement(kind: string, at: [number, number]): DropResult {
  const lib = libraryById[kind];
  const store = useEditorStore.getState();
  const diagram = store.diagram;

  // Bus-on-bus drops would loop; just place free.
  if (!lib || kind === 'busbar') {
    const id = store.addElement(kind, at);
    return { newElementId: id, attachedToBus: false };
  }

  const target = nearestBus(diagram, at);
  if (!target) {
    // Offset so the cursor lands on the element's tap-side pin (same one
    // the place ghost previews) — feels like you're carrying the pin.
    const cursorPin = pickPlaceCursorTerminal(lib);
    const placedAt: [number, number] = cursorPin
      ? [snap(at[0]) - cursorPin.x, snap(at[1]) - cursorPin.y]
      : [snap(at[0]), snap(at[1])];
    const id = store.addElement(kind, placedAt);
    return { newElementId: id, attachedToBus: false };
  }

  // Pick the element's tap pin: terminal whose local y is most negative
  // (top-of-symbol). We also keep it generic by axis.
  const { bus, busPlace } = target;
  const busAxis = libraryById['busbar']?.stretchable?.axis ?? 'x';
  const tapPin = pickTapTerminal(lib, busAxis);
  const newId = newElementId(diagram, kind);

  // Snap the new element's position so its tap-pin sits exactly on the bus.
  const tapLocal = lib.terminals.find((t) => t.id === tapPin);
  const dropX = busAxis === 'x' ? at[0] : busPlace.at[0];
  const dropY = busAxis === 'y' ? at[1] : busPlace.at[1];
  const placedAt: [number, number] = tapLocal
    ? [snap(dropX) - tapLocal.x, snap(dropY) - tapLocal.y]
    : [snap(at[0]), snap(at[1])];

  // Add the new element with its placement, then mutate bus.tap to include the
  // new tap reference. We do both inside a single `dispatch` so it's one
  // undo step.
  store.dispatch((d) => {
    const newElement: Element = { id: newId, kind };
    const placement: Placement = { at: placedAt };
    const tapRef = `${newId}.${tapPin}` as TerminalRef;
    const elements = [...d.elements];
    const idx = elements.findIndex((e) => e.id === bus.id);
    if (idx >= 0) {
      const cur = elements[idx];
      elements[idx] = {
        ...cur,
        tap: [...(cur.tap ?? []), tapRef],
      };
    }
    elements.push(newElement);
    return {
      ...d,
      elements,
      layout: { ...(d.layout ?? {}), [newId]: placement },
    };
  });

  store.setSelection([newId]);
  return { newElementId: newId, attachedToBus: true };
}

interface NearestBus {
  bus: Element;
  busPlace: Placement & { at: [number, number] };
}

function nearestBus(d: DiagramFile, at: [number, number]): NearestBus | null {
  const internal = useEditorStore.getState().internal;
  let best: { bus: Element; place: Placement; dist: number } | null = null;
  for (const el of d.elements) {
    if (el.kind !== 'busbar') continue;
    const place = internal.layout.get(el.id);
    if (!place) continue;
    const lib = libraryById['busbar'];
    if (!lib?.stretchable) continue;
    const span = place.span ?? lib.stretchable.naturalSpan;
    const axis = lib.stretchable.axis;
    let dist: number;
    if (axis === 'x') {
      const minX = place.at[0] - span / 2;
      const maxX = place.at[0] + span / 2;
      const dx = at[0] < minX ? minX - at[0] : at[0] > maxX ? at[0] - maxX : 0;
      const dy = Math.abs(at[1] - place.at[1]);
      dist = Math.sqrt(dx * dx + dy * dy);
    } else {
      const minY = place.at[1] - span / 2;
      const maxY = place.at[1] + span / 2;
      const dy = at[1] < minY ? minY - at[1] : at[1] > maxY ? at[1] - maxY : 0;
      const dx = Math.abs(at[0] - place.at[0]);
      dist = Math.sqrt(dx * dx + dy * dy);
    }
    if (dist <= PROXIMITY_PX && (!best || dist < best.dist)) {
      best = { bus: el, place: { ...place }, dist };
    }
  }
  return best
    ? { bus: best.bus, busPlace: best.place as Placement & { at: [number, number] } }
    : null;
}

function pickTapTerminal(lib: LibraryEntry, busAxis: 'x' | 'y'): string {
  // Use the terminal closest to the bus axis side (most negative y for x-axis
  // buses → top of element sits on the bus, body hangs below).
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
 * Stretchable kinds (busbar) don't have a meaningful tap; for them we return
 * null and callers should use the element's hotspot.
 */
export function pickPlaceCursorTerminal(
  lib: LibraryEntry,
): LibraryTerminal | null {
  if (!lib || lib.stretchable || lib.terminals.length === 0) return null;
  const busAxis = libraryById['busbar']?.stretchable?.axis ?? 'x';
  const sorted = [...lib.terminals].sort((a, b) =>
    busAxis === 'x' ? a.y - b.y : a.x - b.x,
  );
  return sorted[0];
}

/**
 * Resolved place-source: world coords + orientation of the terminal we're
 * dragging from. Handles both real terminals and the busbar virtual `tap`
 * (projected onto the bus axis at the cursor point, with orientation flipped
 * to point toward the drag side so the new element body extends away).
 */
export interface PlaceSource {
  ref: TerminalRef;
  world: [number, number];
  orientation: Orientation;
  /** True iff `ref` is `<busId>.tap` (virtual). */
  isBusTap: boolean;
  /** Set when isBusTap; needed for the bus.tap[] sugar path on commit. */
  busElementId?: ElementId;
}

export function resolvePlaceSource(
  ref: TerminalRef,
  cursorWorld: [number, number],
): PlaceSource | null {
  const internal = useEditorStore.getState().internal;
  // Busbar's `tap` is special: it exists in `internal.terminals` (at bus
  // center), but here we want to project the cursor onto the bus axis so the
  // user controls *where* along the bus the new element attaches — and to
  // commit via `bus.tap[]` sugar instead of a free connection.
  const dot = ref.indexOf('.');
  if (dot > 0) {
    const elemId = ref.slice(0, dot) as ElementId;
    const pin = ref.slice(dot + 1);
    const re = internal.elements.get(elemId);
    if (
      pin === 'tap' &&
      re?.element.kind === 'busbar' &&
      re.libraryDef?.stretchable
    ) {
      const place = internal.layout.get(elemId);
      if (!place) return null;
      const { axis, naturalSpan } = re.libraryDef.stretchable;
      const span = place.span ?? naturalSpan;
      if (axis === 'x') {
        const minX = place.at[0] - span / 2;
        const maxX = place.at[0] + span / 2;
        const x = Math.max(minX, Math.min(maxX, cursorWorld[0]));
        const y = place.at[1];
        const orientation: Orientation = cursorWorld[1] >= y ? 's' : 'n';
        return { ref, world: [x, y], orientation, isBusTap: true, busElementId: elemId };
      }
      const minY = place.at[1] - span / 2;
      const maxY = place.at[1] + span / 2;
      const y = Math.max(minY, Math.min(maxY, cursorWorld[1]));
      const x = place.at[0];
      const orientation: Orientation = cursorWorld[0] >= x ? 'e' : 'w';
      return { ref, world: [x, y], orientation, isBusTap: true, busElementId: elemId };
    }
  }
  const term = internal.terminals.get(ref);
  if (term) {
    return {
      ref,
      world: term.world,
      orientation: term.orientation,
      isBusTap: false,
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
 * Strategy: prefer a terminal whose orientation is opposite to the source's
 * (the body then extends naturally *away* from the source). Tie-break by
 * world distance to source. As a last resort (no opposite-orientation
 * terminal exists in the library), fall back to closest-to-source.
 */
export function pickConnectTerminal(
  lib: LibraryEntry,
  source: PlaceSource,
  placeAt: [number, number],
): LibraryTerminal {
  if (lib.terminals.length === 0) {
    // Library validation should prevent this, but degrade gracefully.
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
 * a single undo step. If the source is a busbar virtual tap, uses the
 * `bus.tap[]` sugar; otherwise appends a regular connection.
 */
export function dropElementFromTerminal(
  kind: string,
  sourceRef: TerminalRef,
  cursorAt: [number, number],
): DropResult | null {
  const lib = libraryById[kind];
  const store = useEditorStore.getState();
  const diagram = store.diagram;
  if (!lib) return null;

  const source = resolvePlaceSource(sourceRef, cursorAt);
  if (!source) return null;

  // If the user barely moved before releasing (i.e. clicked on the terminal
  // instead of dragging), snap the new element so its chosen pin lands
  // exactly on the source — body extends naturally in the opposite
  // direction. Larger movements use the cursor as the placement anchor.
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
    const elements = [...d.elements];
    if (source.isBusTap && source.busElementId) {
      const idx = elements.findIndex((e) => e.id === source.busElementId);
      if (idx >= 0) {
        const cur = elements[idx];
        elements[idx] = {
          ...cur,
          tap: [...(cur.tap ?? []), newPinRef],
        };
      }
      elements.push(newElement);
      return {
        ...d,
        elements,
        layout: { ...(d.layout ?? {}), [newId]: placement },
      };
    }
    elements.push(newElement);
    return {
      ...d,
      elements,
      connections: [...(d.connections ?? []), [sourceRef, newPinRef]],
      layout: { ...(d.layout ?? {}), [newId]: placement },
    };
  });

  store.setSelection([newId]);
  return { newElementId: newId, attachedToBus: source.isBusTap };
}

