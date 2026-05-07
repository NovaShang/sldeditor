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
    const span = place.span ?? referenceSpan(lib);
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

function referenceSpan(lib: LibraryEntry): number {
  const axis = lib.stretchable?.axis ?? 'x';
  const vs = lib.terminals.map((t) => (axis === 'x' ? t.x : t.y));
  if (vs.length < 2) return 0;
  return Math.max(...vs) - Math.min(...vs);
}
