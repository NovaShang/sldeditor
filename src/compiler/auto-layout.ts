/**
 * Best-effort placement for elements lacking a `Placement` in the diagram.
 *
 * Strategy (v0, "good enough to render"):
 *   1. Place buses without explicit layout in a horizontal stack.
 *   2. Snap each `bus.tap[i]` target so its referenced pin lands on the bus
 *      at evenly spaced offsets.
 *   3. BFS from the placed elements through `connections`: each unplaced
 *      neighbor is positioned 40px out along the upstream terminal's exit
 *      direction.
 *   4. Anything still unplaced falls back to a grid in the lower-right.
 */

import type { Connection, Element, ElementId, LibraryEntry, TerminalRef } from '@/model';
import type { ResolvedPlacement } from './internal-model';
import { orientationVec, transformOrientation, transformPoint } from './transforms';

interface AutoLayoutInput {
  elements: Element[];
  connections: Connection[];
  library: ReadonlyMap<string, LibraryEntry>;
  userLayout: ReadonlyMap<ElementId, ResolvedPlacement>;
}

const BUS_X = 320;
const BUS_Y0 = 160;
const BUS_GAP_Y = 200;
const DEFAULT_BUS_SPAN = 600;
const CHAIN_GAP = 40;
const FALLBACK_GRID_X0 = 60;
const FALLBACK_GRID_Y0 = 520;
const FALLBACK_GRID_DX = 80;
const FALLBACK_GRID_DY = 80;
const FALLBACK_GRID_COLS = 8;

export function autoLayout(input: AutoLayoutInput): Map<ElementId, ResolvedPlacement> {
  const { elements, connections, library, userLayout } = input;
  const layout = new Map<ElementId, ResolvedPlacement>(userLayout);

  const elementById = new Map<ElementId, Element>();
  for (const el of elements) elementById.set(el.id, el);

  const libOf = (id: ElementId): LibraryEntry | undefined => {
    const el = elementById.get(id);
    if (!el) return undefined;
    return library.get(el.kind);
  };

  // ---- 1. Place busbars without layout ------------------------------------
  let busIdx = 0;
  for (const el of elements) {
    if (el.kind !== 'busbar') continue;
    if (layout.has(el.id)) {
      busIdx++;
      continue;
    }
    layout.set(el.id, {
      at: [BUS_X, BUS_Y0 + busIdx * BUS_GAP_Y],
      rot: 0,
      mirror: false,
      span: DEFAULT_BUS_SPAN,
    });
    busIdx++;
  }

  // ---- 2. Place bus.tap targets along the bus -----------------------------
  // Each bus distributes its taps evenly along its visual span.
  for (const el of elements) {
    if (el.kind !== 'busbar' || !Array.isArray(el.tap) || el.tap.length === 0) continue;
    const place = layout.get(el.id);
    if (!place) continue;
    const span = place.span ?? DEFAULT_BUS_SPAN;
    const taps = el.tap;
    for (let i = 0; i < taps.length; i++) {
      const tapRef = taps[i];
      const dotIdx = tapRef.indexOf('.');
      if (dotIdx < 0) continue;
      const otherId = tapRef.slice(0, dotIdx);
      const pin = tapRef.slice(dotIdx + 1);
      if (layout.has(otherId)) continue;
      const otherLib = libOf(otherId);
      if (!otherLib) continue;
      const localTerm = otherLib.terminals.find((t) => t.id === pin);
      if (!localTerm) continue;
      // Even distribution along the bus axis.
      const u = (i + 0.5) / taps.length;
      const tapWorldX = place.at[0] - span / 2 + u * span;
      const tapWorldY = place.at[1];
      // Choose orientation so the element sits on the side opposite the bus —
      // i.e. its tap pin lies on the bus, and the rest of the body extends
      // away. The library's terminal local Y already encodes that direction
      // (top-of-element pins are negative Y, bottom-of-element pins positive),
      // so the unrotated placement does the right thing.
      layout.set(otherId, {
        at: [tapWorldX - localTerm.x, tapWorldY - localTerm.y],
        rot: 0,
        mirror: false,
      });
    }
  }

  // ---- 3. BFS through connections to place neighbors of placed elements ---
  // Build adjacency: terminal → connection group
  const groups: TerminalRef[][] = [];
  for (const c of connections) {
    if (Array.isArray(c)) {
      if (c.length >= 2) groups.push(c);
    } else if (c.terminals.length >= 2) {
      groups.push(c.terminals);
    }
  }
  // bus.tap also creates groups (bus library terminals + tap externals)
  for (const el of elements) {
    if (el.kind !== 'busbar' || !Array.isArray(el.tap) || el.tap.length === 0) continue;
    const lib = library.get('busbar');
    if (!lib) continue;
    const busTerms = lib.terminals.map((t) => `${el.id}.${t.id}` as TerminalRef);
    groups.push([...busTerms, ...el.tap]);
  }

  const queue: ElementId[] = [];
  for (const id of layout.keys()) queue.push(id);

  const visited = new Set<ElementId>(queue);

  while (queue.length > 0) {
    const upstreamId = queue.shift()!;
    const upstreamLib = libOf(upstreamId);
    if (!upstreamLib) continue;
    const upstreamPlace = layout.get(upstreamId);
    if (!upstreamPlace) continue;

    for (const group of groups) {
      const upstreamRefInGroup = group.find((r) => r.startsWith(`${upstreamId}.`));
      if (!upstreamRefInGroup) continue;
      const upstreamPin = upstreamRefInGroup.slice(upstreamId.length + 1);
      const upstreamLocal = upstreamLib.terminals.find((t) => t.id === upstreamPin);
      if (!upstreamLocal) continue;
      const upstreamWorld = transformPoint(
        [upstreamLocal.x, upstreamLocal.y],
        upstreamPlace,
      );
      const upstreamOrient = transformOrientation(
        upstreamLocal.orientation,
        upstreamPlace,
      );
      const exit = orientationVec(upstreamOrient);

      for (const ref of group) {
        if (ref === upstreamRefInGroup) continue;
        const dotIdx = ref.indexOf('.');
        if (dotIdx < 0) continue;
        const downId = ref.slice(0, dotIdx);
        const downPin = ref.slice(dotIdx + 1);
        if (layout.has(downId) || visited.has(downId)) continue;
        const downLib = libOf(downId);
        if (!downLib) continue;
        const downLocal = downLib.terminals.find((t) => t.id === downPin);
        if (!downLocal) continue;

        const targetWorld: [number, number] = [
          upstreamWorld[0] + exit[0] * CHAIN_GAP,
          upstreamWorld[1] + exit[1] * CHAIN_GAP,
        ];
        layout.set(downId, {
          at: [targetWorld[0] - downLocal.x, targetWorld[1] - downLocal.y],
          rot: 0,
          mirror: false,
        });
        visited.add(downId);
        queue.push(downId);
      }
    }
  }

  // ---- 4. Fallback grid ---------------------------------------------------
  let placed = 0;
  for (const el of elements) {
    if (layout.has(el.id)) continue;
    const col = placed % FALLBACK_GRID_COLS;
    const row = Math.floor(placed / FALLBACK_GRID_COLS);
    layout.set(el.id, {
      at: [
        FALLBACK_GRID_X0 + col * FALLBACK_GRID_DX,
        FALLBACK_GRID_Y0 + row * FALLBACK_GRID_DY,
      ],
      rot: 0,
      mirror: false,
    });
    placed++;
  }

  return layout;
}
