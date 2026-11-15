/**
 * Cursor quick-insert: where the palette is open and what it will drop onto.
 *
 * Opened by "/" (at the mouse) or "Insert symbol…" in the right-click menu
 * (at the click). The world point and the pin under the cursor are taken
 * when it opens, not when the pick is made: the user aimed before typing.
 */

import { create } from 'zustand';
import { getViewportApi } from '../canvas/viewport-bus';
import { hitBus, hitTerminal } from '../canvas/hit-test';
import type { DiagramType, WireEnd } from '../model';
import type { LibraryEntry } from '../model/library';
import { entryFitsDiagramType } from '../model/diagram-type';
import { dropElement, dropElementFromTerminal } from '../canvas/drop-on-bus';

export interface QuickInsertAt {
  /** Screen point the palette opens at. */
  screen: [number, number];
  /** Canvas point the pick is placed at. */
  world: [number, number];
  /** Pin or junction under the cursor: the pick is placed wired to it. */
  source: WireEnd | null;
}

interface QuickInsertState {
  at: QuickInsertAt | null;
}

export const useQuickInsert = create<QuickInsertState>(() => ({ at: null }));

/** Open the palette for screen point (`clientX`, `clientY`). */
export function openQuickInsert(clientX: number, clientY: number): void {
  const api = getViewportApi();
  if (!api) return;
  const world = api.screenToSvg(clientX, clientY);
  let source: WireEnd | null = null;
  if (typeof document !== 'undefined' && typeof document.elementFromPoint === 'function') {
    const target = document.elementFromPoint(clientX, clientY);
    const hit = hitTerminal(target);
    // A bus is left to the free drop, which taps it the way a click does.
    if (hit && !hitBus(target)) source = hit;
  }
  useQuickInsert.setState({ at: { screen: [clientX, clientY], world, source } });
}

export function closeQuickInsert(): void {
  useQuickInsert.setState({ at: null });
}

let lastPointer: [number, number] | null = null;
let tracking = false;

/** Remember where the mouse is, so "/" can open the palette under it. */
export function trackPointer(): void {
  if (tracking || typeof window === 'undefined') return;
  tracking = true;
  window.addEventListener(
    'pointermove',
    (e) => {
      lastPointer = [e.clientX, e.clientY];
    },
    { passive: true, capture: true },
  );
}

/**
 * Open at the mouse when it is over the canvas, else in the middle of the
 * canvas (keyboard users, a mouse resting on a panel).
 */
export function openQuickInsertAtPointer(): void {
  if (typeof document === 'undefined') return;
  const root = document.querySelector('.ole-canvas-root');
  if (!root) return;
  const r = root.getBoundingClientRect();
  const inside =
    lastPointer !== null &&
    lastPointer[0] >= r.left &&
    lastPointer[0] <= r.right &&
    lastPointer[1] >= r.top &&
    lastPointer[1] <= r.bottom;
  const [x, y] = inside ? lastPointer! : [r.left + r.width / 2, r.top + r.height / 2];
  openQuickInsert(x, y);
}

/** Kinds picked here this session, latest first: shown before typing. */
const recent: string[] = [];
const MAX_RECENT = 8;

export function recentQuickInserts(): readonly string[] {
  return recent;
}

/** Symbols the palette offers on this drawing type (the busbar has a tool). */
export function quickInsertEntries(
  library: ReadonlyMap<string, LibraryEntry>,
  diagramType: DiagramType,
): LibraryEntry[] {
  return [...library.values()].filter((e) => e.id !== 'busbar' && entryFitsDiagramType(e, diagramType));
}

/** Place `kind` the way a click at the palette's spot would. */
export function quickInsertPlace(kind: string, at: QuickInsertAt): void {
  const placed = at.source ? dropElementFromTerminal(kind, at.source, at.world) : null;
  if (!placed) dropElement(kind, at.world);
  const i = recent.indexOf(kind);
  if (i >= 0) recent.splice(i, 1);
  recent.unshift(kind);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
}
