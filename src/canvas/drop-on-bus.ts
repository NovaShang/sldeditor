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

import { libraryById } from '@/element-library';
import type {
  DiagramFile,
  Element,
  ElementId,
  LibraryEntry,
  LibraryTerminal,
  Orientation,
  Placement,
  TerminalRef,
} from '@/model';
import { newElementId } from '@/store';
import { useEditorStore } from '@/store';
import { snap } from './grid';

const PROXIMITY_PX = 30;

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
    const id = store.addElement(kind, at);
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

/**
 * Pick which terminal of the new element should connect to the source. The
 * element is being placed centered at `placeAt` (cursor world coords); we
 * want the terminal whose *world* position lands closest to the source —
 * that's the natural endpoint for the connecting wire.
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
  let best = lib.terminals[0];
  let bestDist = termWorldDist(best, placeAt, source.world);
  for (let i = 1; i < lib.terminals.length; i++) {
    const t = lib.terminals[i];
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

  // Place the new element at the cursor (snapped); pick whichever of its
  // terminals lands closest to the source as the connection point.
  const placedAt: [number, number] = [snap(cursorAt[0]), snap(cursorAt[1])];
  const chosen = pickConnectTerminal(lib, source, placedAt);
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

