/**
 * Best-effort placement for elements lacking a `Placement` in the diagram.
 *
 * Strategy (v1, hierarchy-aware):
 *   1. Identify "linkers" — elements tapped to ≥2 distinct buses (typically
 *      transformers). They imply a bus hierarchy.
 *   2. Topologically order buses: BFS from source-tapped buses → tier 0 down,
 *      with disconnected buses appended. The Y gap between two adjacent buses
 *      is sized to fit the pin-Y span of any linker between them.
 *   3. Place each linker between its bus pair: pinUpper lands on the upper
 *      bus, pinLower on the lower. Rotation flips (0 ↔ 180) when the local
 *      pin order is upside-down relative to the world bus order.
 *   4. Distribute remaining bus taps along the bus span, split into
 *      above-bus / below-bus groups by their local pin Y (so sources don't
 *      crowd the X axis used by loads), with each slot sized to the element's
 *      library width (with a min spacing).
 *   5. BFS through `connections` for any other reachable element. New
 *      placements are nudged in 10px steps along the exit direction until
 *      they no longer overlap a previously placed bbox.
 *   6. Anything still unplaced falls back to a grid in the lower-right.
 *
 * All resolved positions are snapped to a 10px grid so subsequent user
 * drags don't introduce sub-grid jitter.
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
const BUS_Y0 = 220;
const MIN_BUS_GAP_Y = 260;
const DEFAULT_BUS_SPAN = 720;
const CHAIN_GAP = 60;
const MIN_TAP_SPACING = 80;
const LINKER_PIN_Y_PADDING = 80;
const GRID = 10;
const COLLISION_SAFETY_STEPS = 20;
const FALLBACK_GRID_X0 = 60;
const FALLBACK_GRID_Y0 = 520;
const FALLBACK_GRID_DX = 80;
const FALLBACK_GRID_DY = 80;
const FALLBACK_GRID_COLS = 8;

const SOURCE_CATEGORIES = new Set(['source', 'renewable']);

interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface BusAttachment {
  busId: ElementId;
  pin: string;
}

interface LinkerInfo {
  elementId: ElementId;
  attachments: BusAttachment[];
}

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

  const buses: Element[] = elements.filter((e) => e.kind === 'busbar');
  const busIds = new Set(buses.map((b) => b.id));

  // Effective tap map: TerminalRefs of devices attached to each bus, sourced
  // from BOTH the `bus.tap[]` sugar AND explicit connections that mention
  // `<busId>.tap`. Auto-layout uses this single source of truth so adding/
  // removing the sugar form doesn't break placement.
  const effectiveTaps = new Map<ElementId, TerminalRef[]>();
  const pushTap = (busId: ElementId, ref: TerminalRef) => {
    const arr = effectiveTaps.get(busId) ?? [];
    arr.push(ref);
    effectiveTaps.set(busId, arr);
  };
  for (const bus of buses) {
    if (Array.isArray(bus.tap)) {
      for (const ref of bus.tap) pushTap(bus.id, ref);
    }
  }
  for (const conn of connections) {
    const terms = Array.isArray(conn) ? conn : conn.terminals;
    for (const ref of terms) {
      const dot = ref.indexOf('.');
      if (dot < 0) continue;
      const busId = ref.slice(0, dot);
      const pin = ref.slice(dot + 1);
      if (pin !== 'tap' || !busIds.has(busId)) continue;
      for (const other of terms) {
        if (other !== ref) pushTap(busId, other);
      }
    }
  }

  // ---- 1. Detect linker elements (tapped to ≥2 distinct buses) -----------
  const tapsByElement = new Map<ElementId, BusAttachment[]>();
  for (const bus of buses) {
    const refs = effectiveTaps.get(bus.id);
    if (!refs) continue;
    for (const ref of refs) {
      const dot = ref.indexOf('.');
      if (dot < 0) continue;
      const elId = ref.slice(0, dot);
      const pin = ref.slice(dot + 1);
      const arr = tapsByElement.get(elId) ?? [];
      arr.push({ busId: bus.id, pin });
      tapsByElement.set(elId, arr);
    }
  }
  const linkers: LinkerInfo[] = [];
  const linkerIds = new Set<ElementId>();
  for (const [elId, attachments] of tapsByElement) {
    const distinctBuses = new Set(attachments.map((a) => a.busId));
    if (distinctBuses.size >= 2) {
      linkers.push({ elementId: elId, attachments });
      linkerIds.add(elId);
    }
  }

  // ---- 2. Topo-order buses ----------------------------------------------
  // Adjacency: bus → map of (otherBus → linker that connects them).
  const busLinks = new Map<ElementId, Map<ElementId, LinkerInfo>>();
  for (const b of buses) busLinks.set(b.id, new Map());
  for (const link of linkers) {
    const ids = Array.from(new Set(link.attachments.map((a) => a.busId)));
    for (const a of ids) {
      for (const b of ids) {
        if (a !== b) busLinks.get(a)?.set(b, link);
      }
    }
  }

  const isSourceKind = (kind: string): boolean => {
    const cat = library.get(kind)?.category;
    return cat ? SOURCE_CATEGORIES.has(cat) : false;
  };

  const rootBuses: ElementId[] = [];
  for (const bus of buses) {
    const refs = effectiveTaps.get(bus.id);
    if (!refs) continue;
    for (const ref of refs) {
      const dot = ref.indexOf('.');
      if (dot < 0) continue;
      const otherId = ref.slice(0, dot);
      const otherEl = elementById.get(otherId);
      if (otherEl && isSourceKind(otherEl.kind)) {
        rootBuses.push(bus.id);
        break;
      }
    }
  }
  if (rootBuses.length === 0 && buses.length > 0) rootBuses.push(buses[0].id);

  const busOrder: ElementId[] = [];
  const visitedBuses = new Set<ElementId>();
  const bfsQueue: ElementId[] = [...rootBuses];
  while (bfsQueue.length > 0) {
    const id = bfsQueue.shift()!;
    if (visitedBuses.has(id)) continue;
    visitedBuses.add(id);
    busOrder.push(id);
    const links = busLinks.get(id);
    if (links) {
      for (const otherId of links.keys()) {
        if (!visitedBuses.has(otherId)) bfsQueue.push(otherId);
      }
    }
  }
  for (const bus of buses) {
    if (!visitedBuses.has(bus.id)) busOrder.push(bus.id);
  }

  // ---- 3. Place buses with dynamic Y gap ---------------------------------
  // Gap between two adjacent buses = max(MIN_BUS_GAP_Y, |pinUpper.y - pinLower.y|).
  const gapBetween = (idA: ElementId, idB: ElementId): number => {
    const link = busLinks.get(idA)?.get(idB);
    if (!link) return MIN_BUS_GAP_Y;
    const linkerLib = libOf(link.elementId);
    if (!linkerLib) return MIN_BUS_GAP_Y;
    const pinAName = link.attachments.find((a) => a.busId === idA)?.pin;
    const pinBName = link.attachments.find((a) => a.busId === idB)?.pin;
    if (!pinAName || !pinBName) return MIN_BUS_GAP_Y;
    const pinA = linkerLib.terminals.find((t) => t.id === pinAName);
    const pinB = linkerLib.terminals.find((t) => t.id === pinBName);
    if (!pinA || !pinB) return MIN_BUS_GAP_Y;
    return Math.max(
      MIN_BUS_GAP_Y,
      Math.abs(pinB.y - pinA.y) + LINKER_PIN_Y_PADDING,
    );
  };

  let curY = BUS_Y0;
  for (let i = 0; i < busOrder.length; i++) {
    const busId = busOrder[i];
    if (layout.has(busId)) {
      curY = Math.max(curY, layout.get(busId)!.at[1]);
    } else {
      layout.set(busId, {
        at: [snap(BUS_X), snap(curY)],
        rot: 0,
        mirror: false,
        span: DEFAULT_BUS_SPAN,
      });
    }
    if (i + 1 < busOrder.length) {
      curY += gapBetween(busId, busOrder[i + 1]);
    }
  }

  // ---- 4. Place linker elements between their bus pair -------------------
  for (const link of linkers) {
    if (layout.has(link.elementId)) continue;
    const linkerLib = libOf(link.elementId);
    if (!linkerLib) continue;

    // Buses this linker reaches, top-to-bottom by world Y. Need at least 2.
    const reachedBuses = link.attachments
      .map((a) => a.busId)
      .filter((id) => layout.has(id))
      .sort((a, b) => layout.get(a)!.at[1] - layout.get(b)!.at[1]);
    if (reachedBuses.length < 2) continue;
    const upperBusId = reachedBuses[0];
    const lowerBusId = reachedBuses[1];
    const upperPlace = layout.get(upperBusId)!;
    const lowerPlace = layout.get(lowerBusId)!;

    const upperPin = link.attachments.find((a) => a.busId === upperBusId)!.pin;
    const lowerPin = link.attachments.find((a) => a.busId === lowerBusId)!.pin;
    const upperLocal = linkerLib.terminals.find((t) => t.id === upperPin);
    const lowerLocal = linkerLib.terminals.find((t) => t.id === lowerPin);
    if (!upperLocal || !lowerLocal) continue;

    // For rot=0, world.Y = at.Y + local.Y. We need:
    //   upperLocal.y + at.y == upperBus.y  AND  lowerLocal.y + at.y == lowerBus.y
    // → upperLocal.y - lowerLocal.y == upperBus.y - lowerBus.y < 0
    // → upperLocal.y < lowerLocal.y. If the local order is reversed, rotate 180°.
    const rot: 0 | 180 = upperLocal.y <= lowerLocal.y ? 0 : 180;

    const xCenter = upperPlace.at[0];
    const at: [number, number] =
      rot === 0
        ? [snap(xCenter - upperLocal.x), snap(upperPlace.at[1] - upperLocal.y)]
        : [snap(xCenter + upperLocal.x), snap(upperPlace.at[1] + upperLocal.y)];

    layout.set(link.elementId, { at, rot, mirror: false });

    // Bus span sanity: ensure upper bus visually covers the linker's X.
    // (lowerPlace is read-only from this branch; upper is what taps live on.)
    void lowerPlace;
  }

  // ---- 5. Distribute remaining bus tap targets (width-aware, side-split) -
  for (const bus of buses) {
    const tapRefs = effectiveTaps.get(bus.id);
    if (!tapRefs || tapRefs.length === 0) continue;
    const place = layout.get(bus.id);
    if (!place) continue;

    // Skip taps already placed (linkers, or with explicit user layout).
    const remaining = tapRefs.flatMap((ref) => {
      const dot = ref.indexOf('.');
      if (dot < 0) return [];
      const elId = ref.slice(0, dot);
      const pin = ref.slice(dot + 1);
      if (layout.has(elId)) return [];
      const lib = libOf(elId);
      if (!lib) return [];
      const localTerm = lib.terminals.find((t) => t.id === pin);
      if (!localTerm) return [];
      return [{ elId, lib, localTerm }];
    });
    if (remaining.length === 0) continue;

    // Split: pin local Y > 0 → body extends UP from pin (above-bus side).
    //        pin local Y ≤ 0 → body extends DOWN from pin (below-bus side).
    const aboveSide: typeof remaining = [];
    const belowSide: typeof remaining = [];
    for (const r of remaining) {
      if (r.localTerm.y > 0) aboveSide.push(r);
      else belowSide.push(r);
    }

    // Adaptive span: each side is distributed independently, so the wider
    // side dictates the minimum bus length needed to fit its taps. We honor
    // the user's span when it's already enough; otherwise grow it (covers
    // both "no span supplied" and "supplied span too short").
    const sideTotalWidth = (group: typeof remaining): number =>
      group.reduce((s, r) => s + Math.max(r.lib.width, MIN_TAP_SPACING), 0);
    const requiredSpan =
      Math.max(sideTotalWidth(aboveSide), sideTotalWidth(belowSide)) +
      MIN_TAP_SPACING;
    const span = Math.max(place.span ?? DEFAULT_BUS_SPAN, requiredSpan);
    if (span !== place.span) {
      layout.set(bus.id, { ...place, span });
    }

    const distribute = (group: typeof remaining): void => {
      if (group.length === 0) return;
      const widths = group.map((r) => Math.max(r.lib.width, MIN_TAP_SPACING));
      const totalW = widths.reduce((s, w) => s + w, 0);
      // Use the full bus span when taps fit; otherwise extend just enough.
      // Slack is split into N+1 boundaries (margin on each end + N-1 between)
      // so taps spread out instead of clumping at the bus center.
      const usableSpan = Math.max(span, totalW);
      const slotGap = (usableSpan - totalW) / (group.length + 1);
      let cursor = place.at[0] - usableSpan / 2 + slotGap;
      for (let i = 0; i < group.length; i++) {
        const r = group[i];
        const slotW = widths[i];
        const tapWorldX = cursor + slotW / 2;
        const tapWorldY = place.at[1];
        layout.set(r.elId, {
          at: [snap(tapWorldX - r.localTerm.x), snap(tapWorldY - r.localTerm.y)],
          rot: 0,
          mirror: false,
        });
        cursor += slotW + slotGap;
      }
    };

    distribute(aboveSide);
    distribute(belowSide);
  }

  // ---- 6. BFS through connections (collision-aware) ----------------------
  // Build adjacency groups: explicit connections + sugar-derived groups.
  const groups: TerminalRef[][] = [];
  for (const c of connections) {
    if (Array.isArray(c)) {
      if (c.length >= 2) groups.push(c);
    } else if (c.terminals.length >= 2) {
      groups.push(c.terminals);
    }
  }
  for (const bus of buses) {
    const tapRefs = effectiveTaps.get(bus.id);
    if (!tapRefs || tapRefs.length === 0) continue;
    // Express as a group `[B.tap, ...members]` so the BFS treats the bus
    // as the hub for its taps.
    groups.push([`${bus.id}.tap` as TerminalRef, ...tapRefs]);
  }

  const placedBboxes: BBox[] = [];
  for (const [id, p] of layout) {
    const lib = libOf(id);
    if (lib) placedBboxes.push(approxBbox(p, lib));
  }

  const queue: ElementId[] = Array.from(layout.keys());
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
        // Linkers handled in Stage 4; don't re-place them here even if also
        // referenced by a regular `connections` entry.
        if (linkerIds.has(downId)) continue;
        const downLib = libOf(downId);
        if (!downLib) continue;
        const downLocal = downLib.terminals.find((t) => t.id === downPin);
        if (!downLocal) continue;

        const targetWorld: [number, number] = [
          upstreamWorld[0] + exit[0] * CHAIN_GAP,
          upstreamWorld[1] + exit[1] * CHAIN_GAP,
        ];
        let at: [number, number] = [
          snap(targetWorld[0] - downLocal.x),
          snap(targetWorld[1] - downLocal.y),
        ];
        let placement: ResolvedPlacement = { at, rot: 0, mirror: false };
        let bbox = approxBbox(placement, downLib);
        let safety = COLLISION_SAFETY_STEPS;
        while (
          placedBboxes.some((b) => bboxOverlaps(b, bbox)) &&
          safety-- > 0
        ) {
          at = [snap(at[0] + exit[0] * GRID), snap(at[1] + exit[1] * GRID)];
          placement = { at, rot: 0, mirror: false };
          bbox = approxBbox(placement, downLib);
        }
        layout.set(downId, placement);
        placedBboxes.push(bbox);
        visited.add(downId);
        queue.push(downId);
      }
    }
  }

  // ---- 7. Fallback grid for orphans -------------------------------------
  let placedCount = 0;
  for (const el of elements) {
    if (layout.has(el.id)) continue;
    const col = placedCount % FALLBACK_GRID_COLS;
    const row = Math.floor(placedCount / FALLBACK_GRID_COLS);
    layout.set(el.id, {
      at: [
        snap(FALLBACK_GRID_X0 + col * FALLBACK_GRID_DX),
        snap(FALLBACK_GRID_Y0 + row * FALLBACK_GRID_DY),
      ],
      rot: 0,
      mirror: false,
    });
    placedCount++;
  }

  return layout;
}

function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

/**
 * Conservative world-frame bbox approximation: assumes the library's
 * `width × height` is centered on the placement origin. Library viewBoxes
 * usually offset from origin, so this can be loose by up to half-extent —
 * fine for nudge-until-clear collision avoidance.
 */
function approxBbox(p: ResolvedPlacement, lib: LibraryEntry): BBox {
  const rotated = p.rot === 90 || p.rot === 270;
  const w = rotated ? lib.height : lib.width;
  const h = rotated ? lib.width : lib.height;
  return { x: p.at[0] - w / 2, y: p.at[1] - h / 2, w, h };
}

function bboxOverlaps(a: BBox, b: BBox): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}
