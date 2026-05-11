/**
 * Best-effort placement for elements lacking a `Placement` in the diagram.
 *
 * Strategy (hierarchy-aware):
 *   1. Identify "linkers" — elements connecting ≥2 distinct buses. Three
 *      passes: (a) direct `<bus>.tap` membership; (b) transitive BFS for
 *      category='transformer' elements wired through chains of switches —
 *      the BFS finds *all* reachable buses, so a transformer feeding two
 *      parallel HV bars (BI + BII via a Y of disconnectors) registers as
 *      a 3-bus linker; (c) breakers that bridge two buses through chains
 *      with no transformer in path are flagged as horizontal linkers
 *      (bus ties / couplers).
 *   2. Tier assignment via BFS from source-tapped buses. Vertical linkers
 *      (transformers) step a level; horizontal linkers (bus ties) keep
 *      the level unchanged so same-voltage buses share a Y. Disconnected
 *      buses fall into an orphan tier at the bottom.
 *   3. Bottom-up bus span propagation. Each bus's span = max(BUS_MIN_SPAN,
 *      total slot width + edge margin). Tap slots that stand in for a
 *      downstream bus (vertical linker chain head, or the linker itself
 *      for direct-tap) claim the child bus's span + spacing, so two
 *      parallel children reserve enough horizontal real estate that they
 *      don't overlap.
 *   4. Tier-walking placement: at each level pick the Y from previous
 *      level + max parent-child gap; pick each bus's X (root → default
 *      or sibling-spread; non-root → midpoint of all parent linkers'
 *      chain-head X, so a 3-bus child naturally lands between its
 *      upstream parents); distribute the bus's taps with slot ordering
 *      biased by `tapPreferredX` (chain endpoints reaching another
 *      placed bus get pulled toward that side, with a wider-first
 *      tiebreak so narrow taps reach the actual edges); place vertical
 *      linkers (anchored to the upper-side chain heads' midpoint, with
 *      Y-junction chain alignment so the chain between merge node and
 *      linker sits cleanly on the linker's column); place horizontal
 *      linkers (rotated 90°/270° between the two same-level buses).
 *   5. Resolve electrical nodes via union-find. For each node with placed
 *      and unplaced members, vote on an anchor (placed pin most directly
 *      co-referenced) and lay out the remaining elements as parallel
 *      branches perpendicular to the anchor's exit. Iterate to a fixpoint
 *      so multi-step chains terminate on a real anchor instead of being
 *      routed back across a bus.
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
const MIN_BUS_GAP_Y = 260;
const DEFAULT_BUS_SPAN = 720;
const CHAIN_GAP = 30;
// Distance from a bus line to the first chain element's pin. The tap pin
// is offset off the bus by this amount so the tap body doesn't sit flush
// against the busbar — visually a short wire stub between bus and the
// first switch, matching how real one-line diagrams are drawn. Mirrors
// CHAIN_GAP so the bus→first and first→next gaps look uniform.
const BUS_TAP_OFFSET = 30;
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
  /**
   * `vertical`: connects buses at different voltage levels (transformer).
   * Drives level transitions in bus-level BFS and Y-gap calculation.
   *
   * `horizontal`: bus-tie style coupling between same-voltage buses
   * (typically a chain of switches with a breaker in the middle). Buses on
   * either side stay at the same level. The chain elements are placed as
   * regular taps; this entry exists for level-tracking only.
   */
  orientation: 'vertical' | 'horizontal';
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

  // Per-bus tap list. Sourced from any connection group containing
  // `<busId>.tap` — co-members of that group are the tap devices.
  const effectiveTaps = new Map<ElementId, TerminalRef[]>();
  const pushTap = (busId: ElementId, ref: TerminalRef) => {
    const arr = effectiveTaps.get(busId) ?? [];
    arr.push(ref);
    effectiveTaps.set(busId, arr);
  };
  for (const conn of connections) {
    for (const ref of conn) {
      const dot = ref.indexOf('.');
      if (dot < 0) continue;
      const busId = ref.slice(0, dot);
      const pin = ref.slice(dot + 1);
      if (pin !== 'tap' || !busIds.has(busId)) continue;
      for (const other of conn) {
        if (other !== ref) pushTap(busId, other);
      }
    }
  }

  // Index raw connection groups by pin. Used for chain-extent estimates and
  // the node-based stage-6 BFS.
  const rawGroups: TerminalRef[][] = connections.filter((c) => c.length >= 2);
  const pinToGroups = new Map<TerminalRef, TerminalRef[][]>();
  for (const group of rawGroups) {
    for (const pin of group) {
      const arr = pinToGroups.get(pin);
      if (arr) arr.push(group);
      else pinToGroups.set(pin, [group]);
    }
  }
  const isBusPin = (ref: TerminalRef): boolean => {
    const dot = ref.indexOf('.');
    if (dot < 0) return false;
    return busIds.has(ref.slice(0, dot));
  };

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
  // `linkerIds` holds only vertical linkers — those with explicit cross-tier
  // placement in stage 5. Horizontal linkers (bus ties) flow through stage
  // 4/6 like any chain element and stay out of this set so stage 6 picks
  // them up as regular branches.
  const linkerIds = new Set<ElementId>();
  for (const [elId, attachments] of tapsByElement) {
    const distinctBuses = new Set(attachments.map((a) => a.busId));
    if (distinctBuses.size >= 2) {
      const orientation: 'vertical' | 'horizontal' =
        library.get(elementById.get(elId)?.kind ?? '')?.category === 'transformer'
          ? 'vertical'
          : 'horizontal';
      linkers.push({ elementId: elId, attachments, orientation });
      if (orientation === 'vertical') linkerIds.add(elId);
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
  const allGroups: TerminalRef[][] = connections.filter((c) => c.length >= 2);
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
    // pin -> ALL reachable buses (not just first). Crucial for 3-bus
    // configurations like a transformer whose HV side reaches two parallel
    // 220 kV bars (BI + BII) through a Y of disconnectors.
    const busesPerPin = new Map<string, Set<ElementId>>();
    for (const startRef of myRefs) {
      const startPin = startRef.slice(el.id.length + 1);
      busesPerPin.set(startPin, new Set());
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
            // Record but don't expand bus.tap further — we want every bus
            // reachable from this terminal, not the buses' other taps.
            busesPerPin.get(startPin)!.add(elemId);
            continue;
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
    const distinctBuses = new Set<ElementId>();
    for (const buses of busesPerPin.values()) {
      for (const b of buses) distinctBuses.add(b);
    }
    if (distinctBuses.size >= 2) {
      const attachments: BusAttachment[] = [];
      for (const [pin, buses] of busesPerPin) {
        for (const busId of buses) attachments.push({ busId, pin });
      }
      linkers.push({ elementId: el.id, attachments, orientation: 'vertical' });
      linkerIds.add(el.id);
    }
  }

  // ---- 1c. Transitive horizontal-linker detection (bus-tie breakers) -----
  // A breaker bridging two buses through chains on each side — without a
  // transformer in either chain — is a bus tie / bus coupler. Detection is
  // restricted to category='switching', kind='breaker' to avoid flooding
  // the linker set with every disconnector in a chain. The chain elements
  // themselves are placed via stage 4/6 normal flow; this entry only
  // exists so bus-level BFS knows the two buses are at the same level.
  for (const el of elements) {
    if (el.kind === 'busbar') continue;
    if (linkerIds.has(el.id)) continue;
    if (el.kind !== 'breaker') continue;
    const lib = library.get(el.kind);
    if (!lib || lib.terminals.length !== 2) continue;

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
          // Block passthrough through transformers — transformer paths are
          // vertical linkers and don't make this candidate a bus tie.
          const nbDot = nb.indexOf('.');
          if (nbDot > 0) {
            const nbElemId = nb.slice(0, nbDot);
            if (nbElemId !== el.id) {
              const nbEl = elementById.get(nbElemId);
              const nbLib = nbEl ? library.get(nbEl.kind) : undefined;
              if (nbLib?.category === 'transformer') continue;
            }
          }
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
      linkers.push({
        elementId: el.id,
        attachments,
        orientation: 'horizontal',
      });
      // Don't add to linkerIds — horizontal linkers don't have explicit
      // placement; they go through stage 4/6 as ordinary chain elements.
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

  // Tier assignment: BFS from each root bus. Vertical linkers step down a
  // level (parent → child); horizontal linkers (bus ties) keep both buses
  // at the same level. Two buses connected only via a horizontal linker
  // therefore land side-by-side at the same Y rather than stacked.
  const busLevel = new Map<ElementId, number>();
  for (const r of rootBuses) busLevel.set(r, 0);
  {
    const bfsQ: ElementId[] = [...rootBuses];
    while (bfsQ.length > 0) {
      const id = bfsQ.shift()!;
      const lvl = busLevel.get(id)!;
      const links = busLinks.get(id);
      if (!links) continue;
      for (const [otherId, link] of links) {
        if (busLevel.has(otherId)) continue;
        const childLevel =
          link.orientation === 'horizontal' ? lvl : lvl + 1;
        busLevel.set(otherId, childLevel);
        bfsQ.push(otherId);
      }
    }
  }
  // Disconnected buses fall to a level beyond the deepest reachable one.
  for (const bus of buses) {
    if (busLevel.has(bus.id)) continue;
    const maxLvl = busLevel.size === 0
      ? -1
      : Math.max(...Array.from(busLevel.values()));
    busLevel.set(bus.id, maxLvl + 1);
  }
  const levelToBuses = new Map<number, ElementId[]>();
  for (const bus of buses) {
    const lvl = busLevel.get(bus.id)!;
    const arr = levelToBuses.get(lvl) ?? [];
    arr.push(bus.id);
    levelToBuses.set(lvl, arr);
  }
  const sortedLevels = [...levelToBuses.keys()].sort((a, b) => a - b);

  // ---- 3. Place buses with dynamic Y gap ---------------------------------
  // The gap floors at `MIN_BUS_GAP_Y` and stretches to fit whatever sits in
  // between: the linker's pin span plus the chain length on each side.
  // chainExtentToBus walks the connection graph from a linker pin back to
  // the bus, accumulating per-element pin-to-pin spans + per-edge CHAIN_GAP
  // contributions — exactly what stage 5/6 will materialize. With this the
  // gap auto-grows to fit a long chain (bus → disconnector → CT → breaker →
  // transformer) instead of squashing it.
  interface ChainResult {
    extent: number;
    /** The chain element directly tapped to the bus (for X-alignment). */
    head?: ElementId;
  }
  const chainExtentToBus = (
    linker: LinkerInfo,
    busId: ElementId,
    pinName: string,
  ): ChainResult => {
    const startRef = `${linker.elementId}.${pinName}` as TerminalRef;
    const targetRef = `${busId}.tap` as TerminalRef;
    const linkerLib = libOf(linker.elementId);
    // Forbid the linker's other terminals so BFS doesn't re-enter through
    // the device itself and short-circuit to the other bus.
    const forbidden = new Set<TerminalRef>();
    if (linkerLib) {
      for (const t of linkerLib.terminals) {
        if (t.id === pinName) continue;
        forbidden.add(`${linker.elementId}.${t.id}` as TerminalRef);
      }
    }
    const visited = new Set<TerminalRef>([startRef]);
    const queue: { ref: TerminalRef; dist: number }[] = [
      { ref: startRef, dist: 0 },
    ];
    const parent = new Map<TerminalRef, TerminalRef>();
    const enqueue = (other: TerminalRef, ref: TerminalRef, addDist: number, dist: number) => {
      visited.add(other);
      parent.set(other, ref);
      queue.push({ ref: other, dist: dist + addDist });
    };
    while (queue.length > 0) {
      const { ref, dist } = queue.shift()!;
      if (ref === targetRef) {
        const prev = parent.get(targetRef);
        let head: ElementId | undefined;
        if (prev) {
          const d = prev.indexOf('.');
          if (d > 0) {
            const headId = prev.slice(0, d);
            // Direct-tap linker: the only path into bus.tap is from the
            // linker's own pin. Skip self-as-head so callers fall through
            // to the slot-based fallback (linkerSlotX) instead of trying
            // to look up the linker's not-yet-known position.
            if (headId !== linker.elementId) head = headId;
          }
        }
        return { extent: dist, head };
      }
      const dot = ref.indexOf('.');
      if (dot < 0) continue;
      const elId = ref.slice(0, dot);
      const pin = ref.slice(dot + 1);
      // Passthrough through a non-bus, non-linker element: enqueue its other
      // terminals with the local pin-to-pin distance added.
      if (!busIds.has(elId) && !linkerIds.has(elId)) {
        const lib = libOf(elId);
        const thisTerm = lib?.terminals.find((t) => t.id === pin);
        if (lib && thisTerm) {
          for (const otherTerm of lib.terminals) {
            if (otherTerm.id === pin) continue;
            const otherRef = `${elId}.${otherTerm.id}` as TerminalRef;
            if (visited.has(otherRef) || forbidden.has(otherRef)) continue;
            enqueue(otherRef, ref, Math.abs(thisTerm.y - otherTerm.y), dist);
          }
        }
      }
      // Cross to other pins via raw connections. Bus.tap edges contribute
      // BUS_TAP_OFFSET (the wire stub between bus line and the tap pin);
      // inter-element edges contribute CHAIN_GAP.
      for (const g of pinToGroups.get(ref) ?? []) {
        for (const other of g) {
          if (other === ref) continue;
          if (visited.has(other) || forbidden.has(other)) continue;
          const isBusEdge = isBusPin(ref) || isBusPin(other);
          enqueue(other, ref, isBusEdge ? BUS_TAP_OFFSET : CHAIN_GAP, dist);
        }
      }
    }
    return { extent: 0 };
  };

  const gapBetween = (idA: ElementId, idB: ElementId): number => {
    const link = busLinks.get(idA)?.get(idB);
    // Horizontal linkers (bus ties) sit at the same level — they don't
    // contribute a vertical Y-gap at all. Treat them as no-link here.
    if (!link || link.orientation === 'horizontal') return MIN_BUS_GAP_Y;
    const linkerLib = libOf(link.elementId);
    if (!linkerLib) return MIN_BUS_GAP_Y;
    const pinAName = link.attachments.find((a) => a.busId === idA)?.pin;
    const pinBName = link.attachments.find((a) => a.busId === idB)?.pin;
    if (!pinAName || !pinBName) return MIN_BUS_GAP_Y;
    const pinA = linkerLib.terminals.find((t) => t.id === pinAName);
    const pinB = linkerLib.terminals.find((t) => t.id === pinBName);
    if (!pinA || !pinB) return MIN_BUS_GAP_Y;
    const pinSpan = Math.abs(pinB.y - pinA.y);
    // idA is upper in busOrder, idB is lower. Each side may have a chain;
    // measure both so the gap fits whichever is longer.
    const upperChain = chainExtentToBus(link, idA, pinAName).extent;
    const lowerChain = chainExtentToBus(link, idB, pinBName).extent;
    // With a linker, fit the gap exactly to chain + pinSpan + chain so the
    // linker's pins land on both buses (no floating stub). MIN_BUS_GAP_Y
    // only floors the no-linker case (orphan tiers stacked at the bottom).
    return upperChain + pinSpan + lowerChain;
  };

  // ---- Linker → upper-bus tap representative ----------------------------
  // Each linker contributes one slot to its UPPER bus's tap distribution.
  // For a transitive linker (chain on the upper side), that slot belongs to
  // the chain head element — the tap closest to the bus. For a direct-tap
  // linker the slot belongs to the linker itself. We record the mapping so
  // both span computation and slot allocation know which entry is "really"
  // a child-bus stand-in and need to be widened accordingly.
  interface LinkerRep {
    /** The downstream bus this slot leads to. */
    lowerBusId: ElementId;
  }
  const linkerUpperRep = new Map<ElementId, LinkerRep>();
  for (const link of linkers) {
    // Only vertical linkers contribute downstream-bus span to the parent's
    // tap distribution. Horizontal (bus tie) linkers don't have a "child"
    // — both sides are siblings at the same level — and they're rendered
    // as regular chain elements anyway.
    if (link.orientation !== 'vertical') continue;
    const sortedAttachments = link.attachments
      .slice()
      .sort(
        (a, b) => (busLevel.get(a.busId) ?? 0) - (busLevel.get(b.busId) ?? 0),
      );
    if (sortedAttachments.length < 2) continue;
    const upperBusId = sortedAttachments[0].busId;
    const lowerBusId = sortedAttachments[1].busId;
    const upperPin = sortedAttachments[0].pin;
    const result = chainExtentToBus(link, upperBusId, upperPin);
    const repElId = result.head ?? link.elementId;
    linkerUpperRep.set(repElId, { lowerBusId });
  }

  // ---- Bottom-up bus span computation -----------------------------------
  // Each bus's span = max(BUS_MIN_SPAN, content width). Tap entries that
  // stand in for a downstream bus claim that bus's span as their slot
  // width, so two parallel children (two transformers feeding two
  // downstream bars) reserve enough horizontal space on the parent for
  // both children to sit side-by-side without overlapping.
  const BUS_MIN_SPAN = 320;
  const busSpan = new Map<ElementId, number>();
  const isLinkerLowerSide = (
    elId: ElementId,
    busId: ElementId,
  ): boolean => {
    if (!linkerIds.has(elId)) return false;
    const link = linkers.find((l) => l.elementId === elId);
    const otherBusAtt = link?.attachments.find((a) => a.busId !== busId);
    if (!otherBusAtt) return false;
    const myLvl = busLevel.get(busId) ?? 0;
    const otherLvl = busLevel.get(otherBusAtt.busId) ?? 0;
    // Lower bus has the higher level number; if the linker's other end is
    // at a lower level, this bus is the lower one and shouldn't allocate
    // a slot for the linker (the upper bus owns it).
    return otherLvl < myLvl;
  };
  const slotWidthFor = (
    elId: ElementId,
    libWidth: number,
  ): number => {
    const rep = linkerUpperRep.get(elId);
    if (rep) {
      const childSpan = busSpan.get(rep.lowerBusId);
      if (childSpan !== undefined) {
        return Math.max(libWidth, childSpan + MIN_TAP_SPACING);
      }
    }
    return Math.max(libWidth, MIN_TAP_SPACING);
  };
  const computeSpan = (busId: ElementId, visiting: Set<ElementId>): number => {
    if (busSpan.has(busId)) return busSpan.get(busId)!;
    if (visiting.has(busId)) return BUS_MIN_SPAN; // cycle guard
    visiting.add(busId);
    const tapRefs = effectiveTaps.get(busId) ?? [];
    let aboveW = 0;
    let belowW = 0;
    for (const ref of tapRefs) {
      const dot = ref.indexOf('.');
      if (dot < 0) continue;
      const elId = ref.slice(0, dot);
      const pin = ref.slice(dot + 1);
      if (isLinkerLowerSide(elId, busId)) continue;
      const lib = libOf(elId);
      if (!lib) continue;
      const localTerm = lib.terminals.find((t) => t.id === pin);
      if (!localTerm) continue;
      const rep = linkerUpperRep.get(elId);
      if (rep) {
        // Recurse so the child's span is known before we widen the slot.
        computeSpan(rep.lowerBusId, visiting);
      }
      const slotW = slotWidthFor(elId, lib.width);
      if (localTerm.y > 0) aboveW += slotW;
      else belowW += slotW;
    }
    const span = Math.max(
      BUS_MIN_SPAN,
      Math.max(aboveW, belowW) + MIN_TAP_SPACING,
    );
    busSpan.set(busId, span);
    visiting.delete(busId);
    return span;
  };
  for (const bus of buses) computeSpan(bus.id, new Set());

  // ---- 3-5. Tier-based bus / tap / linker placement ---------------------
  // Walk levels top-down. For each level: pick a Y from the previous
  // level's Y plus the maximum parent-child gap; pick each bus's X (root =
  // default; non-root = the parent linker's slot X on its upper bus, so
  // children land in distinct columns); distribute that bus's taps; then
  // place every linker whose lower bus is at this level (both endpoints
  // are now placed and chain heads on both sides are known).
  const linkerSlotX = new Map<ElementId, number>();

  interface TapEntry {
    elId: ElementId;
    lib: LibraryEntry;
    localTerm: { id: string; x: number; y: number; orientation: Orientation };
    isLinker: boolean;
  }

  // Find the X of the closest other-bus that this tap reaches via the
  // connection graph (passing through any chain element). Returned only if
  // that bus has already been placed. Used to bias slot ordering so chain
  // endpoints (bus-tie or cross-bay arms) land on the bus side closest to
  // their counterpart, shrinking the wire that auto-route has to draw.
  const tapPreferredX = (
    busId: ElementId,
    tapEl: ElementId,
    tapPin: string,
  ): number | undefined => {
    const tapLib = libOf(tapEl);
    if (!tapLib) return undefined;
    const tapRef = `${tapEl}.${tapPin}` as TerminalRef;
    const startRefs = tapLib.terminals
      .filter((t) => t.id !== tapPin)
      .map((t) => `${tapEl}.${t.id}` as TerminalRef);
    if (startRefs.length === 0) return undefined;
    const visited = new Set<TerminalRef>([tapRef, ...startRefs]);
    const queue: TerminalRef[] = startRefs.slice();
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const dot = cur.indexOf('.');
      if (dot > 0) {
        const elemId = cur.slice(0, dot);
        const pinName = cur.slice(dot + 1);
        if (busIds.has(elemId) && pinName === 'tap' && elemId !== busId) {
          const place = layout.get(elemId);
          return place ? place.at[0] : undefined;
        }
      }
      for (const g of pinToGroups.get(cur) ?? []) {
        for (const other of g) {
          if (other === cur || visited.has(other)) continue;
          visited.add(other);
          queue.push(other);
        }
      }
      if (dot > 0) {
        const elemId = cur.slice(0, dot);
        if (!busIds.has(elemId)) {
          const lib = libOf(elemId);
          if (lib) {
            for (const t of lib.terminals) {
              const otherRef = `${elemId}.${t.id}` as TerminalRef;
              if (visited.has(otherRef)) continue;
              visited.add(otherRef);
              queue.push(otherRef);
            }
          }
        }
      }
    }
    return undefined;
  };

  const distributeBusTaps = (bus: Element): void => {
    const tapRefs = effectiveTaps.get(bus.id);
    if (!tapRefs || tapRefs.length === 0) return;
    const place = layout.get(bus.id);
    if (!place) return;

    const remaining: TapEntry[] = tapRefs.flatMap((ref): TapEntry[] => {
      const dot = ref.indexOf('.');
      if (dot < 0) return [];
      const elId = ref.slice(0, dot);
      const pin = ref.slice(dot + 1);
      if (layout.has(elId)) return [];
      // Skip linker on its lower-bus side — the upper bus owns the slot.
      if (isLinkerLowerSide(elId, bus.id)) return [];
      const lib = libOf(elId);
      if (!lib) return [];
      const localTerm = lib.terminals.find((t) => t.id === pin);
      if (!localTerm) return [];
      return [{ elId, lib, localTerm, isLinker: linkerIds.has(elId) }];
    });
    if (remaining.length === 0) return;

    const aboveSide: TapEntry[] = [];
    const belowSide: TapEntry[] = [];
    for (const r of remaining) {
      if (r.localTerm.y > 0) aboveSide.push(r);
      else belowSide.push(r);
    }

    const sideTotalWidth = (group: TapEntry[]): number =>
      group.reduce((s, r) => s + slotWidthFor(r.elId, r.lib.width), 0);
    const requiredSpan =
      Math.max(sideTotalWidth(aboveSide), sideTotalWidth(belowSide)) +
      MIN_TAP_SPACING;
    const span = Math.max(place.span ?? DEFAULT_BUS_SPAN, requiredSpan);
    if (span !== place.span) {
      layout.set(bus.id, { ...place, span });
    }

    const distribute = (group: TapEntry[], offsetSign: -1 | 1): void => {
      if (group.length === 0) return;
      // Sort by preferred X (chain endpoints reaching another already-placed
      // bus get pulled toward that bus's side; everyone else stays neutral
      // around the bus center).
      const prefByEl = new Map<ElementId, number>();
      for (const r of group) {
        const px = tapPreferredX(bus.id, r.elId, r.localTerm.id);
        if (px !== undefined) prefByEl.set(r.elId, px);
      }
      group.sort((a, b) => {
        const ax = prefByEl.get(a.elId) ?? place.at[0];
        const bx = prefByEl.get(b.elId) ?? place.at[0];
        if (ax !== bx) return ax - bx;
        // Among same-preference taps, wider slots go first so they sit
        // toward the bus center; narrow ones get pushed to the extreme.
        // That way a small bus-tie disconnector lands on the actual edge
        // even when a wide transformer-feeding slot wants the same side.
        const aw = slotWidthFor(a.elId, a.lib.width);
        const bw = slotWidthFor(b.elId, b.lib.width);
        return bw - aw;
      });
      const widths = group.map((r) => slotWidthFor(r.elId, r.lib.width));
      const totalW = widths.reduce((s, w) => s + w, 0);
      const usableSpan = Math.max(span, totalW);
      const slotGap = (usableSpan - totalW) / (group.length + 1);
      let cursor = place.at[0] - usableSpan / 2 + slotGap;
      // Push the tap pin off the bus by BUS_TAP_OFFSET (above buses are
      // negative-Y direction, below buses are positive-Y); auto-route fills
      // in the short wire stub between bus line and pin.
      const tapWorldY = place.at[1] + offsetSign * BUS_TAP_OFFSET;
      for (let i = 0; i < group.length; i++) {
        const r = group[i];
        const slotW = widths[i];
        const tapWorldX = cursor + slotW / 2;
        if (r.isLinker) {
          // First-encounter wins: tier loop visits buses top-down, so the
          // upper bus's slot is locked in first. The same linker reappears
          // on the lower bus's tap (via its other pin) — ignore that slot.
          if (!linkerSlotX.has(r.elId)) linkerSlotX.set(r.elId, tapWorldX);
        } else {
          layout.set(r.elId, {
            at: [snap(tapWorldX - r.localTerm.x), snap(tapWorldY - r.localTerm.y)],
            rot: 0,
            mirror: false,
          });
        }
        cursor += slotW + slotGap;
      }
    };
    distribute(aboveSide, -1);
    distribute(belowSide, +1);
  };

  const placeLinker = (link: LinkerInfo): void => {
    if (layout.has(link.elementId)) return;
    // Horizontal linkers (bus ties) flow through stage 4/6 as regular chain
    // elements — they don't get explicit between-bus placement. Skip.
    if (link.orientation === 'horizontal') return;
    const linkerLib = libOf(link.elementId);
    if (!linkerLib) return;

    // Sort by bus level (smallest = upper). For 3-bus linkers (e.g., a
    // transformer whose HV side reaches BI *and* BII), pick the lowest
    // level as "upper anchor" and the highest as "lower". The other
    // upper-level attachments contribute to the X midpoint below.
    const placedAttachments = link.attachments.filter((a) =>
      layout.has(a.busId),
    );
    if (placedAttachments.length < 2) return;
    const sorted = placedAttachments.slice().sort(
      (a, b) =>
        (busLevel.get(a.busId) ?? 0) - (busLevel.get(b.busId) ?? 0),
    );
    const upperBusId = sorted[0].busId;
    const upperPlace = layout.get(upperBusId)!;

    const upperPin = sorted[0].pin;
    const lowerPin = sorted[sorted.length - 1].pin;
    const upperLocal = linkerLib.terminals.find((t) => t.id === upperPin);
    const lowerLocal = linkerLib.terminals.find((t) => t.id === lowerPin);
    if (!upperLocal || !lowerLocal) return;

    const rot: 0 | 180 = upperLocal.y <= lowerLocal.y ? 0 : 180;

    // Y-junction support: a 3-bus linker has multiple attachments sharing
    // the same upper pin (one chain to BI, another to BII). Compute the
    // chain head X for each and place the linker at their midpoint so the
    // body sits cleanly between the upper bars. Use the max chain extent
    // so the linker pin clears the deepest chain end on either side.
    const upperLevel = busLevel.get(upperBusId) ?? 0;
    const upperSideAttachments = placedAttachments.filter(
      (a) => (busLevel.get(a.busId) ?? 0) === upperLevel,
    );
    const upperHeadXs: number[] = [];
    let maxUpperExtent = 0;
    for (const att of upperSideAttachments) {
      const result = chainExtentToBus(link, att.busId, att.pin);
      maxUpperExtent = Math.max(maxUpperExtent, result.extent);
      const headPlace = result.head ? layout.get(result.head) : undefined;
      if (headPlace) {
        upperHeadXs.push(headPlace.at[0]);
      } else {
        upperHeadXs.push(layout.get(att.busId)!.at[0]);
      }
    }
    let xCenter: number;
    if (upperHeadXs.length > 0) {
      xCenter =
        upperHeadXs.reduce((s, x) => s + x, 0) / upperHeadXs.length;
    } else if (linkerSlotX.has(link.elementId)) {
      // Direct-tap linker fallback (slot allocated by tap distribution).
      xCenter = linkerSlotX.get(link.elementId)!;
    } else {
      xCenter = upperPlace.at[0];
    }
    const upperPinWorldY = upperPlace.at[1] + maxUpperExtent;

    const at: [number, number] =
      rot === 0
        ? [snap(xCenter - upperLocal.x), snap(upperPinWorldY - upperLocal.y)]
        : [snap(xCenter + upperLocal.x), snap(upperPinWorldY + upperLocal.y)];
    layout.set(link.elementId, { at, rot, mirror: false });

    // Y-junction chain alignment: for 3-bus linkers (multiple upper-side
    // attachments), walk the chain from the linker's upper pin back toward
    // the merge node, placing each chain element at the linker's X. Without
    // this, those elements stay anchored to one upper bus's chain head
    // (whichever is voted in stage 6), creating a kink between the chain
    // and the linker. Stops at the first multi-pin (≥3) connection group,
    // which is the merge node — auto-route handles the rake from there.
    if (upperSideAttachments.length > 1) {
      const linkerPlace = layout.get(link.elementId)!;
      const upperPinWorld = transformPoint(
        [upperLocal.x, upperLocal.y],
        linkerPlace,
      );
      const upperWorldOrient = transformOrientation(
        upperLocal.orientation,
        linkerPlace,
      );
      walkChainAlongAxis(
        `${link.elementId}.${upperPin}` as TerminalRef,
        upperPinWorld,
        upperWorldOrient,
        xCenter,
      );
    }
  };

  // Walk a single-pin chain starting from `startRef` (an already-placed
  // pin), heading in the world `startExit` direction. At each step, find
  // the next element via a raw size-2 connection group and place it at
  // `axisX` so the whole chain stays on a single column. Stops when:
  //   - the next group has ≥3 members (a Y-junction merge node)
  //   - the next neighbour is a bus, linker, or already-placed element
  //   - no eligible neighbour remains
  const walkChainAlongAxis = (
    startRef: TerminalRef,
    startWorld: [number, number],
    startExit: Orientation,
    axisX: number,
  ): void => {
    const visited = new Set<TerminalRef>([startRef]);
    let prevRef = startRef;
    let prevWorld = startWorld;
    let prevExit = startExit;
    while (true) {
      const groups = pinToGroups.get(prevRef) ?? [];
      let nextRef: TerminalRef | undefined;
      let blocked = false;
      for (const g of groups) {
        if (g.length >= 3) {
          // Multi-pin merge — stop and let auto-route draw the rake.
          blocked = true;
          break;
        }
        const other = g.find((r) => r !== prevRef);
        if (!other || visited.has(other)) continue;
        if (isBusPin(other)) {
          // Reached the bus directly (no intermediate element). Stop.
          blocked = true;
          break;
        }
        nextRef = other;
        break;
      }
      if (blocked || !nextRef) break;
      const dot = nextRef.indexOf('.');
      if (dot < 0) break;
      const elId = nextRef.slice(0, dot);
      const pinName = nextRef.slice(dot + 1);
      if (busIds.has(elId) || linkerIds.has(elId)) break;
      if (layout.has(elId)) break;
      const lib = libOf(elId);
      if (!lib) break;
      const inTerm = lib.terminals.find((t) => t.id === pinName);
      if (!inTerm) break;

      const exitVec = orientationVec(prevExit);
      const target: [number, number] = [
        prevWorld[0] + exitVec[0] * CHAIN_GAP,
        prevWorld[1] + exitVec[1] * CHAIN_GAP,
      ];
      const desiredOrient = OPPOSITE_ORIENT[prevExit];
      const rot = rotationToAlignOrient(inTerm.orientation, desiredOrient);
      const rotatedInPin = transformPoint([inTerm.x, inTerm.y], {
        at: [0, 0],
        rot,
        mirror: false,
      });
      // X anchored on axisX (so the body sits on the column). Y derived from
      // chain progression. snap() keeps positions on the 10-px grid.
      const at: [number, number] = [
        snap(axisX - rotatedInPin[0]),
        snap(target[1] - rotatedInPin[1]),
      ];
      layout.set(elId, { at, rot, mirror: false });
      visited.add(nextRef);

      // Find the OTHER pin to continue the chain, if any.
      const outTerm = lib.terminals.find((t) => t.id !== pinName);
      if (!outTerm) break;
      const outRef = `${elId}.${outTerm.id}` as TerminalRef;
      visited.add(outRef);
      const placement = { at, rot, mirror: false };
      prevWorld = transformPoint([outTerm.x, outTerm.y], placement);
      prevExit = transformOrientation(outTerm.orientation, placement);
      prevRef = outRef;
    }
  };

  // Horizontal linker placement: rotate the device 90°/270° so its pin span
  // runs left-right between two same-level buses, and center it at the X
  // midpoint of the two chain heads. The chain elements on each side
  // (e.g., QS_BT_I, QS_BT_II disconnectors) stay placed as ordinary taps
  // hanging below their respective buses; auto-route fills in the wire
  // stubs from each chain head to the linker's pins.
  const placeHorizontalLinker = (link: LinkerInfo): void => {
    if (layout.has(link.elementId)) return;
    if (link.orientation !== 'horizontal') return;
    const linkerLib = libOf(link.elementId);
    if (!linkerLib) return;
    const placed = link.attachments.filter((a) => layout.has(a.busId));
    if (placed.length < 2) return;

    interface HeadInfo {
      att: BusAttachment;
      x: number;
      extent: number;
    }
    const heads: HeadInfo[] = placed.map((att) => {
      const result = chainExtentToBus(link, att.busId, att.pin);
      const headPlace = result.head ? layout.get(result.head) : undefined;
      const x = headPlace
        ? headPlace.at[0]
        : layout.get(att.busId)!.at[0];
      return { att, x, extent: result.extent };
    });
    heads.sort((a, b) => a.x - b.x);
    const left = heads[0];
    const right = heads[heads.length - 1];
    const leftLocal = linkerLib.terminals.find((t) => t.id === left.att.pin);
    const rightLocal = linkerLib.terminals.find((t) => t.id === right.att.pin);
    if (!leftLocal || !rightLocal) return;

    // For breakers/disconnectors with vertical pin layout (t1.y < 0, t2.y > 0):
    // rot=270 maps the smaller-Y pin to the world-LEFT, larger-Y to RIGHT.
    // rot=90 is the mirror image. Pick whichever puts the left attachment's
    // pin on the left.
    const rot: 90 | 270 = leftLocal.y <= rightLocal.y ? 270 : 90;

    const xCenter = (left.x + right.x) / 2;
    const busY = layout.get(left.att.busId)!.at[1];
    const linkerY = busY + Math.max(left.extent, right.extent);

    layout.set(link.elementId, {
      at: [snap(xCenter), snap(linkerY)],
      rot,
      mirror: false,
    });
  };

  // Sibling buses at the same level that are NOT linker-bridged get spread
  // horizontally so they don't overlap when sharing a Y. (Linker-bridged
  // siblings inherit their X from chain-head X of the parent linker, which
  // is computed below — this only matters for level 0 with multiple roots
  // or for orphan tiers added at the bottom.)
  const SIBLING_X_GAP = 100;

  let prevLevelY = BUS_Y0;
  for (let li = 0; li < sortedLevels.length; li++) {
    const lvl = sortedLevels[li];
    const busIdsAtLevel = levelToBuses.get(lvl)!;

    let levelY: number;
    if (li === 0) {
      levelY = BUS_Y0;
    } else {
      const prevBusIds = levelToBuses.get(sortedLevels[li - 1])!;
      let maxGap = 0;
      for (const parent of prevBusIds) {
        for (const child of busIdsAtLevel) {
          if (busLinks.get(parent)?.get(child)) {
            maxGap = Math.max(maxGap, gapBetween(parent, child));
          }
        }
      }
      // No linker between prev level and this level (orphan tier) → use the
      // global floor.
      if (maxGap === 0) maxGap = MIN_BUS_GAP_Y;
      levelY = prevLevelY + maxGap;
    }
    prevLevelY = levelY;

    // Place each bus at this level. Linker-bridged children center on the
    // parent linker's chain head; siblings without a linker spread out so
    // they don't overlap.
    let nextSiblingX = BUS_X;
    for (const busId of busIdsAtLevel) {
      if (layout.has(busId)) {
        prevLevelY = Math.max(prevLevelY, layout.get(busId)!.at[1]);
        continue;
      }
      let busX: number | undefined;
      if (li > 0) {
        const prevBusIds = levelToBuses.get(sortedLevels[li - 1])!;
        // Collect chain-head X from EVERY upper-level parent that links to
        // this child (3-bus linker has two — one chain head per upper bus).
        // The child centers on the midpoint, so it sits between its
        // upstream parents instead of being yanked to one side.
        const headXs: number[] = [];
        for (const parent of prevBusIds) {
          const link = busLinks.get(parent)?.get(busId);
          if (!link || link.orientation !== 'vertical') continue;
          const parentPin = link.attachments.find(
            (a) => a.busId === parent,
          )?.pin;
          if (!parentPin) continue;
          const result = chainExtentToBus(link, parent, parentPin);
          if (result.head && layout.has(result.head)) {
            headXs.push(layout.get(result.head)!.at[0]);
          } else if (linkerSlotX.has(link.elementId)) {
            headXs.push(linkerSlotX.get(link.elementId)!);
          } else {
            headXs.push(layout.get(parent)!.at[0]);
          }
        }
        if (headXs.length > 0) {
          busX = headXs.reduce((s, x) => s + x, 0) / headXs.length;
        }
      }
      if (busX === undefined) {
        const ownSpan = busSpan.get(busId) ?? DEFAULT_BUS_SPAN;
        busX = nextSiblingX + ownSpan / 2;
        nextSiblingX += ownSpan + SIBLING_X_GAP;
      }
      layout.set(busId, {
        at: [snap(busX), snap(levelY)],
        rot: 0,
        mirror: false,
        span: busSpan.get(busId) ?? DEFAULT_BUS_SPAN,
      });
    }

    // Distribute taps for each bus at this level — needs to happen after the
    // bus is placed so chain heads have known X for the next level.
    for (const busId of busIdsAtLevel) {
      const bus = elementById.get(busId);
      if (bus) distributeBusTaps(bus);
    }

    // Place every linker whose lower bus is at this level. Both endpoints
    // are placed by now and chain heads on both sides have been distributed.
    if (li > 0) {
      for (const link of linkers) {
        if (layout.has(link.elementId)) continue;
        const involvesThisLevel = link.attachments.some((a) =>
          busIdsAtLevel.includes(a.busId),
        );
        if (!involvesThisLevel) continue;
        placeLinker(link);
      }
    }

    // Place horizontal linkers between same-level buses (bus-tie chains).
    // All endpoints are at this level, so this only fires once both
    // siblings + their chain-head taps are placed.
    for (const link of linkers) {
      if (link.orientation !== 'horizontal') continue;
      if (layout.has(link.elementId)) continue;
      const allHere = link.attachments.every((a) =>
        busIdsAtLevel.includes(a.busId),
      );
      if (!allHere) continue;
      placeHorizontalLinker(link);
    }
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
  // Reuse the early `pinToGroups` map (built before stage 3) and feed it
  // into a pin-level union-find for electrical-node detection.
  const uf = new UnionFind<TerminalRef>();
  for (const group of rawGroups) {
    for (let i = 1; i < group.length; i++) uf.union(group[0], group[i]);
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
