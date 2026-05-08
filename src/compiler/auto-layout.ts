/**
 * Best-effort placement for elements lacking a `Placement` in the diagram.
 *
 * Strategy (hierarchy-aware):
 *   1. Identify "linkers" — elements connecting ≥2 distinct buses. We use two
 *      passes: (a) a strict check on direct `<bus>.tap` membership, and (b) a
 *      transitive BFS for category='transformer' elements that wire to one
 *      bus directly and another through a chain of switches/breakers (the
 *      common substation pattern).
 *   2. Topologically order buses: BFS from source-tapped buses → tier 0 down,
 *      with disconnected buses appended. The Y gap between two linker-bridged
 *      buses equals the linker's pin Y-span exactly so its terminals land on
 *      both bars; otherwise a default minimum is used.
 *   3. Place each linker between its bus pair: pinUpper lands on the upper
 *      bus, pinLower on the lower. Rotation flips (0 ↔ 180) when the local
 *      pin order is upside-down relative to the world bus order.
 *   4. Distribute remaining bus taps along the bus span, split into
 *      above-bus / below-bus groups by their local pin Y (so sources don't
 *      crowd the X axis used by loads), with each slot sized to the element's
 *      library width (with a min spacing).
 *   5. Resolve electrical nodes via union-find (raw connections + bus taps).
 *      For each node with placed and unplaced members, vote on an anchor pin
 *      (the placed pin most directly connected to the unplaced cluster) and
 *      lay the remaining elements out as parallel branches along the
 *      perpendicular to the anchor's exit direction. Iterate to a fixpoint
 *      so chained downstream elements eventually anchor on a placed pin
 *      rather than being routed back across the bus.
 *   6. Anything still unplaced falls back to a grid in the lower-right.
 *
 * All resolved positions are snapped to a 10px grid so subsequent user
 * drags don't introduce sub-grid jitter.
 */

import type {
  Connection,
  Element,
  ElementId,
  LibraryEntry,
  Orientation,
  TerminalRef,
} from '../model';
import type { ResolvedPlacement } from './internal-model';
import { orientationVec, transformOrientation, transformPoint } from './transforms';
import { UnionFind } from './union-find';

const ORIENT_CYCLE: readonly Orientation[] = ['n', 'e', 's', 'w'];
const OPPOSITE_ORIENT: Record<Orientation, Orientation> = {
  n: 's',
  s: 'n',
  e: 'w',
  w: 'e',
};

/**
 * Pick rot ∈ {0, 90, 180, 270} so a local-frame pin oriented `localO` ends up
 * pointing `worldO` after placement. Used to flip downstream chain elements so
 * their connecting pin faces the upstream wire (otherwise body extends into
 * the path and looks reversed).
 */
function rotationToAlignOrient(
  localO: Orientation,
  worldO: Orientation,
): 0 | 90 | 180 | 270 {
  const li = ORIENT_CYCLE.indexOf(localO);
  const wi = ORIENT_CYCLE.indexOf(worldO);
  const steps = ((wi - li) % 4 + 4) % 4;
  return [0, 90, 180, 270][steps] as 0 | 90 | 180 | 270;
}

interface AutoLayoutInput {
  elements: Element[];
  connections: Connection[];
  library: ReadonlyMap<string, LibraryEntry>;
  userLayout: ReadonlyMap<ElementId, ResolvedPlacement>;
}

const BUS_X = 320;
const BUS_Y0 = 220;
const MIN_BUS_GAP_Y = 480;
const DEFAULT_BUS_SPAN = 720;
const CHAIN_GAP = 60;
const MIN_TAP_SPACING = 80;
const GRID = 10;
const FALLBACK_GRID_X0 = 60;
const FALLBACK_GRID_Y0 = 520;
const FALLBACK_GRID_DX = 80;
const FALLBACK_GRID_DY = 80;
const FALLBACK_GRID_COLS = 8;

const SOURCE_CATEGORIES = new Set(['source', 'renewable']);

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

  // ---- 1b. Transitive linker detection for transformer-family elements ---
  // The strict tapsByElement check above only catches elements that are
  // *directly* in two `<bus>.tap` groups. Most fixtures actually wire
  // transformers through a chain of switches/breakers (T1.t1 → QF → QS →
  // B1.tap), which leaves `T1` looking like a single-bus device.
  //
  // We rebuild a per-terminal connection graph, BFS from each terminal of a
  // candidate transformer (forbidding its own *other* terminals), and check
  // if at least two distinct buses are reachable. This recovers the linker
  // semantics without flooding every chained switch into the linker set —
  // we only consider category 'transformer'.
  const allGroups: TerminalRef[][] = [];
  for (const c of connections) {
    const ts = Array.isArray(c) ? c : c.terminals;
    if (ts.length >= 2) allGroups.push(ts);
  }
  for (const bus of buses) {
    const refs = effectiveTaps.get(bus.id);
    if (!refs || refs.length === 0) continue;
    allGroups.push([`${bus.id}.tap` as TerminalRef, ...refs]);
  }
  const refAdj = new Map<TerminalRef, Set<TerminalRef>>();
  const addRefEdge = (a: TerminalRef, b: TerminalRef) => {
    if (a === b) return;
    if (!refAdj.has(a)) refAdj.set(a, new Set());
    if (!refAdj.has(b)) refAdj.set(b, new Set());
    refAdj.get(a)!.add(b);
    refAdj.get(b)!.add(a);
  };
  for (const group of allGroups) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        addRefEdge(group[i], group[j]);
      }
    }
  }
  // Treat each non-bus element as a passthrough between its terminals so BFS
  // can walk QF.t1 → QF.t2 (different connection groups but same physical
  // device) on its way to the next bus.
  for (const el of elements) {
    if (el.kind === 'busbar') continue;
    const lib = library.get(el.kind);
    if (!lib || lib.terminals.length < 2) continue;
    const refs = lib.terminals.map(
      (t) => `${el.id}.${t.id}` as TerminalRef,
    );
    for (let i = 0; i < refs.length; i++) {
      for (let j = i + 1; j < refs.length; j++) {
        addRefEdge(refs[i], refs[j]);
      }
    }
  }

  for (const el of elements) {
    if (el.kind === 'busbar') continue;
    if (linkerIds.has(el.id)) continue;
    const lib = library.get(el.kind);
    if (!lib || lib.category !== 'transformer') continue;
    if (lib.terminals.length < 2) continue;

    const myRefs = lib.terminals.map(
      (t) => `${el.id}.${t.id}` as TerminalRef,
    );
    const busPerPin = new Map<string, ElementId>();
    for (const startRef of myRefs) {
      const startPin = startRef.slice(el.id.length + 1);
      const forbidden = new Set(myRefs.filter((r) => r !== startRef));
      const visited = new Set<TerminalRef>([startRef]);
      const queue: TerminalRef[] = [startRef];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        const dot = cur.indexOf('.');
        if (dot > 0) {
          const elemId = cur.slice(0, dot);
          const pinName = cur.slice(dot + 1);
          if (busIds.has(elemId) && pinName === 'tap') {
            busPerPin.set(startPin, elemId);
            break;
          }
        }
        const neighbors = refAdj.get(cur);
        if (!neighbors) continue;
        for (const nb of neighbors) {
          if (visited.has(nb) || forbidden.has(nb)) continue;
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    const distinctBuses = new Set(busPerPin.values());
    if (distinctBuses.size >= 2) {
      const attachments: BusAttachment[] = [];
      for (const [pin, busId] of busPerPin) {
        attachments.push({ busId, pin });
      }
      linkers.push({ elementId: el.id, attachments });
      linkerIds.add(el.id);
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
  // The gap is at least `MIN_BUS_GAP_Y` to leave room for the chain elements
  // and labels that hang in between. With a linker we additionally honor its
  // pin span so the linker can fit; if the span is larger than the minimum,
  // the gap stretches to match. When the minimum is larger, the linker's
  // far pin floats above the lower bus and auto-route draws a stub down to
  // the bus (sourced from the bus.tap connection).
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
    return Math.max(MIN_BUS_GAP_Y, Math.abs(pinB.y - pinA.y));
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

  // ---- 6. Node-based parallel-branch placement --------------------------
  // The earlier implementation walked raw connection groups and chained
  // each downstream off whichever upstream was visited first. That blew up
  // on multi-pin nodes — three earthing switches sharing `QF2.t2` were
  // serialized via collision-nudge, and any sibling reached through the
  // *wrong* pin (e.g. QE7 reached via QE1.t_top) was placed pointing back
  // across the bus.
  //
  // Now we resolve electrical nodes via union-find and, for each node with
  // unplaced members, pick the anchor pin by *voting* on raw connection
  // co-membership. Unplaced elements that share an anchor pin are laid out
  // as parallel branches along the perpendicular to the anchor's exit. We
  // iterate to a fixpoint so newly-placed elements can anchor further
  // chains. Bus-tap nodes use stage-5 placements; the synthetic `B*.tap`
  // pin is excluded from anchor candidates.
  const uf = new UnionFind<TerminalRef>();
  const rawGroups: TerminalRef[][] = [];
  for (const conn of connections) {
    const terms = Array.isArray(conn) ? conn : conn.terminals;
    if (terms.length < 2) continue;
    rawGroups.push(terms);
    for (let i = 1; i < terms.length; i++) uf.union(terms[0], terms[i]);
  }
  for (const bus of buses) {
    const tapKey = `${bus.id}.tap` as TerminalRef;
    const taps = effectiveTaps.get(bus.id);
    if (!taps || taps.length === 0) continue;
    uf.add(tapKey);
    for (const t of taps) {
      uf.union(tapKey, t);
      // Each tap is also a "raw group" so voting can credit a placed tap
      // when an unplaced sibling co-references it.
      rawGroups.push([tapKey, t]);
    }
  }
  for (const el of elements) {
    if (el.kind === 'busbar') {
      uf.add(`${el.id}.tap` as TerminalRef);
      continue;
    }
    const lib = libOf(el.id);
    if (!lib) continue;
    for (const t of lib.terminals) uf.add(`${el.id}.${t.id}` as TerminalRef);
  }

  const isPinPlaced = (ref: TerminalRef): boolean => {
    const dot = ref.indexOf('.');
    if (dot < 0) return false;
    const id = ref.slice(0, dot);
    return layout.has(id);
  };
  const isBusPin = (ref: TerminalRef): boolean => {
    const dot = ref.indexOf('.');
    if (dot < 0) return false;
    return busIds.has(ref.slice(0, dot));
  };

  // Index pin → list of raw groups containing it. Used for vote-based anchor
  // selection so QE5 → QF2.t1 (not QF1.t1) when both are placed in the same
  // bus-tap node.
  const pinToGroups = new Map<TerminalRef, TerminalRef[][]>();
  for (const group of rawGroups) {
    for (const pin of group) {
      const arr = pinToGroups.get(pin);
      if (arr) arr.push(group);
      else pinToGroups.set(pin, [group]);
    }
  }

  // Iterate to fixpoint: each pass places one "layer" of parallel branches.
  // Newly-placed elements expose their other terminals as anchors for the
  // next pass, so chained downstream elements still get reached.
  let progressed = true;
  let safety = elements.length + 4;
  while (progressed && safety-- > 0) {
    progressed = false;
    const nodeRoots = uf.groups();

    for (const [, node] of nodeRoots) {
      if (node.length < 2) continue;

      interface UnplacedPinInfo {
        ref: TerminalRef;
        elId: ElementId;
        lib: LibraryEntry;
        localTerm: {
          id: string;
          x: number;
          y: number;
          orientation: Orientation;
        };
      }
      const placedPins: TerminalRef[] = [];
      // De-dup unplaced by element id at collection time — we only need one
      // pin per element (the one in this node) to position it.
      const unplacedByEl = new Map<ElementId, UnplacedPinInfo>();

      for (const ref of node) {
        const dot = ref.indexOf('.');
        if (dot < 0) continue;
        const id = ref.slice(0, dot);
        const pinName = ref.slice(dot + 1);
        if (busIds.has(id)) {
          // Bus.tap is a virtual hub, not a real pin we can hang branches
          // from. Stage 5 owns bus-side distribution.
          continue;
        }
        if (layout.has(id)) {
          placedPins.push(ref);
          continue;
        }
        if (linkerIds.has(id)) continue;
        if (unplacedByEl.has(id)) continue;
        const lib = libOf(id);
        if (!lib) continue;
        const localTerm = lib.terminals.find((t) => t.id === pinName);
        if (!localTerm) continue;
        unplacedByEl.set(id, { ref, elId: id, lib, localTerm });
      }
      if (unplacedByEl.size === 0 || placedPins.length === 0) continue;
      const unplacedUnique = [...unplacedByEl.values()];

      // Vote on anchor: each unplaced pin contributes a vote to every placed
      // pin it co-occurs with in a raw group. Strong winner = the placed pin
      // most directly connected to the unplaced cluster.
      const votes = new Map<TerminalRef, number>();
      for (const u of unplacedUnique) {
        const groups = pinToGroups.get(u.ref);
        if (!groups) continue;
        for (const g of groups) {
          for (const p of g) {
            if (p === u.ref) continue;
            if (!isPinPlaced(p) || isBusPin(p)) continue;
            votes.set(p, (votes.get(p) ?? 0) + 1);
          }
        }
      }

      let anchor: TerminalRef | undefined;
      if (votes.size > 0) {
        let best = -1;
        for (const [p, v] of votes) {
          if (v > best || (v === best && (anchor === undefined || p < anchor))) {
            best = v;
            anchor = p;
          }
        }
      }
      if (!anchor) {
        // Fallback: any placed non-bus pin in the node.
        anchor = [...placedPins].sort()[0];
      }
      if (!anchor) continue;

      const dot = anchor.indexOf('.');
      const anchorId = anchor.slice(0, dot);
      const anchorPin = anchor.slice(dot + 1);
      const anchorLib = libOf(anchorId);
      const anchorPlace = layout.get(anchorId);
      if (!anchorLib || !anchorPlace) continue;
      const anchorTerm = anchorLib.terminals.find((t) => t.id === anchorPin);
      if (!anchorTerm) continue;

      const anchorWorld = transformPoint(
        [anchorTerm.x, anchorTerm.y],
        anchorPlace,
      );
      const anchorOrient = transformOrientation(
        anchorTerm.orientation,
        anchorPlace,
      );
      const exit = orientationVec(anchorOrient);
      const perp: [number, number] = [-exit[1], exit[0]];

      // Deterministic distribution order.
      unplacedUnique.sort((a, b) => a.elId.localeCompare(b.elId));
      const widths = unplacedUnique.map((u) =>
        Math.max(u.lib.width, MIN_TAP_SPACING),
      );
      const totalW = widths.reduce((sum, w) => sum + w, 0);
      let cursor = -totalW / 2;

      for (let i = 0; i < unplacedUnique.length; i++) {
        const u = unplacedUnique[i];
        const slotW = widths[i];
        const slotCenter = cursor + slotW / 2;
        cursor += slotW;

        const desiredOrient = OPPOSITE_ORIENT[anchorOrient];
        const rot = rotationToAlignOrient(
          u.localTerm.orientation,
          desiredOrient,
        );
        const rotatedPin = transformPoint(
          [u.localTerm.x, u.localTerm.y],
          { at: [0, 0], rot, mirror: false },
        );
        const targetWorld: [number, number] = [
          anchorWorld[0] + exit[0] * CHAIN_GAP + perp[0] * slotCenter,
          anchorWorld[1] + exit[1] * CHAIN_GAP + perp[1] * slotCenter,
        ];
        const at: [number, number] = [
          snap(targetWorld[0] - rotatedPin[0]),
          snap(targetWorld[1] - rotatedPin[1]),
        ];
        layout.set(u.elId, { at, rot, mirror: false });
        progressed = true;
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
