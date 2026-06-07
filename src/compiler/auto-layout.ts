/**
 * Best-effort placement for elements lacking a `Placement` in the diagram.
 *
 * Strategy (hierarchy-aware):
 *   1. Identify "linkers" — elements connecting ≥2 distinct buses. Three
 *      passes: (a) direct bus tap (the element is an electrical-node co-
 *      member of ≥2 buses); (b) transitive BFS for category='transformer'
 *      elements wired through chains of switches — the BFS finds *all*
 *      reachable buses, so a transformer feeding two parallel HV bars
 *      (BI + BII via a Y of disconnectors) registers as a 3-bus linker;
 *      (c) breakers that bridge two buses through chains with no
 *      transformer in path are flagged as horizontal linkers (bus
 *      ties / couplers).
 *   2. Tier assignment via BFS from source-tapped buses. Vertical linkers
 *      (transformers) step a level; horizontal linkers (bus ties) keep
 *      the level unchanged so same-voltage buses share a Y. Disconnected
 *      buses fall into an orphan tier at the bottom.
 *   3. Bottom-up bus span propagation. Each bus's span = max(BUS_MIN_SPAN,
 *      total slot width + edge margin). Tap slots that stand in for a
 *      downstream bus (vertical linker chain head, or the linker itself
 *      for direct-tap) claim the child bus's span + spacing.
 *   4. Tier-walking placement: at each level pick the Y from previous
 *      level + max parent-child gap; pick each bus's X (root → default
 *      or sibling-spread; non-root → midpoint of all parent linkers'
 *      chain-head X, so a 3-bus child naturally lands between its
 *      upstream parents); distribute the bus's taps with slot ordering
 *      biased by `tapPreferredX`; place vertical linkers (anchored to
 *      the upper-side chain heads' midpoint, with Y-junction chain
 *      alignment so the chain between merge node and linker sits cleanly
 *      on the linker's column); place horizontal linkers (rotated
 *      90°/270° between the two same-level buses).
 *   5. Resolve electrical nodes via union-find. For each node with placed
 *      and unplaced members, vote on an anchor (placed pin most directly
 *      co-referenced) and lay out the remaining elements as parallel
 *      branches perpendicular to the anchor's exit. Iterate to a fixpoint
 *      so multi-step chains terminate on a real anchor instead of being
 *      routed back across a bus. (5b) Bus-less diagrams are seeded with one
 *      root per connected component first, so this pass can grow a vertical
 *      chain instead of dumping everything into the fallback grid.
 *   6. Post-placement cleanup: (6b) separate co-tier feeds into the same bus
 *      that resolved to the same column by shifting the smaller colliding
 *      sub-branch sideways; (6c) tight-repack same-tier buses using their
 *      *actual* extents (the bottom-up span estimate over-allocates, so
 *      independent bars otherwise sprawl) — guarded with a snapshot so it
 *      rolls back if it introduces overlaps; (6d) a final global overlap
 *      sweep; (7) anything still unplaced falls back to a grid lower-right.
 *
 * Bus-span reservation accounts for each tap's stage-6 subtree fan (so a CT
 * feeding a load + an earthing-switch gets a wide enough slot that adjacent
 * taps' children don't collide), bounded to a shallow depth so deep
 * distribution chains don't blow the span up.
 *
 * All resolved positions are snapped to a 10px grid so subsequent user
 * drags don't introduce sub-grid jitter.
 */

import type {
  Bus,
  BusId,
  Element,
  ElementId,
  LibraryEntry,
  Orientation,
  TerminalRef,
  Wire,
  WireEnd,
} from '../model';
import {
  busAxisFromRot,
  type BusGeometry,
  type ResolvedPlacement,
} from './internal-model';
import { orientationVec, transformOrientation, transformPoint } from './transforms';
import { UnionFind } from './union-find';

const ORIENT_CYCLE: readonly Orientation[] = ['n', 'e', 's', 'w'];
const OPPOSITE_ORIENT: Record<Orientation, Orientation> = {
  n: 's',
  s: 'n',
  e: 'w',
  w: 'e',
};

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
  /** Devices only. Buses are in `buses`. */
  elements: Element[];
  buses: Bus[];
  wires: Wire[];
  library: ReadonlyMap<string, LibraryEntry>;
  userLayout: ReadonlyMap<ElementId, ResolvedPlacement>;
  userBusLayout: ReadonlyMap<BusId, BusGeometry>;
}

export interface AutoLayoutOutput {
  devices: Map<ElementId, ResolvedPlacement>;
  buses: Map<BusId, BusGeometry>;
}

const BUS_X = 320;
const BUS_Y0 = 220;
const MIN_BUS_GAP_Y = 260;
const DEFAULT_BUS_SPAN = 720;
const CHAIN_GAP = 30;
// Distance from a bus line to the first chain element's pin.
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
  busId: BusId;
  pin: string;
}

interface LinkerInfo {
  elementId: ElementId;
  attachments: BusAttachment[];
  orientation: 'vertical' | 'horizontal';
}

export function autoLayout(input: AutoLayoutInput): AutoLayoutOutput {
  const { elements, buses: busList, wires, library, userLayout, userBusLayout } = input;

  const layout = new Map<ElementId, ResolvedPlacement>(userLayout);
  const busLayout = new Map<BusId, BusGeometry>(userBusLayout);

  const elementById = new Map<ElementId, Element>();
  for (const el of elements) elementById.set(el.id, el);
  const busById = new Map<BusId, Bus>();
  for (const b of busList) busById.set(b.id, b);

  const libOf = (id: ElementId): LibraryEntry | undefined => {
    const el = elementById.get(id);
    if (!el) return undefined;
    return library.get(el.kind);
  };

  const busIds = new Set<BusId>(busList.map((b) => b.id));
  const isBus = (end: WireEnd): boolean => busIds.has(end);

  // ---- 0. Union-find on wires → electrical nodes ------------------------
  // Members of a node are a mix of `TerminalRef` ("X.Y", device pins) and
  // bare bus ids ("X", hyperedge nodes).
  const uf = new UnionFind<WireEnd>();
  for (const w of wires) {
    uf.add(w.ends[0]);
    uf.add(w.ends[1]);
    uf.union(w.ends[0], w.ends[1]);
  }
  for (const el of elements) {
    const lib = library.get(el.kind);
    if (!lib) continue;
    for (const t of lib.terminals) uf.add(`${el.id}.${t.id}` as TerminalRef);
  }
  for (const bus of busList) uf.add(bus.id);

  const nodeGroups: WireEnd[][] = [];
  for (const [, members] of uf.groups()) {
    if (members.length >= 2) nodeGroups.push(members);
  }

  // For each end, the single node it belongs to (wrapped in the outer
  // array so iteration shape matches the legacy `[][]` form). `g.length
  // >= 3` then means "merge node" exactly as before.
  const pinToGroups = new Map<WireEnd, WireEnd[][]>();
  for (const group of nodeGroups) {
    for (const m of group) pinToGroups.set(m, [group]);
  }

  // Per-bus tap list: for each bus, the other members of its electrical
  // node. Picked up by stage 1 (linker detection), stage 4 (root buses),
  // and the bus-span / tap-distribution passes.
  const effectiveTaps = new Map<BusId, WireEnd[]>();
  for (const group of nodeGroups) {
    const busMembers = group.filter(isBus);
    if (busMembers.length === 0) continue;
    for (const busMember of busMembers) {
      const others = group.filter((m) => m !== busMember);
      const arr = effectiveTaps.get(busMember) ?? [];
      arr.push(...others);
      effectiveTaps.set(busMember, arr);
    }
  }

  // ---- 1. Detect linker elements (in node-co-membership with ≥2 buses) ---
  const tapsByElement = new Map<ElementId, BusAttachment[]>();
  for (const group of nodeGroups) {
    const busMembers = group.filter(isBus);
    if (busMembers.length === 0) continue;
    for (const end of group) {
      if (isBus(end)) continue;
      const dot = end.indexOf('.');
      if (dot < 0) continue;
      const elId = end.slice(0, dot);
      const pin = end.slice(dot + 1);
      const arr = tapsByElement.get(elId) ?? [];
      for (const busId of busMembers) {
        if (!arr.some((a) => a.busId === busId && a.pin === pin)) {
          arr.push({ busId, pin });
        }
      }
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
  // The direct check above only catches elements *directly* sharing a node
  // with two buses. Most fixtures actually wire transformers through a
  // chain of switches/breakers (T1.t1 → QF → QS → B1), so T1 looks like a
  // single-bus device. We rebuild a per-end connection graph and BFS from
  // each terminal of a candidate transformer, checking reachability to ≥2
  // buses.
  const refAdj = new Map<WireEnd, Set<WireEnd>>();
  const addRefEdge = (a: WireEnd, b: WireEnd) => {
    if (a === b) return;
    if (!refAdj.has(a)) refAdj.set(a, new Set());
    if (!refAdj.has(b)) refAdj.set(b, new Set());
    refAdj.get(a)!.add(b);
    refAdj.get(b)!.add(a);
  };
  for (const w of wires) {
    addRefEdge(w.ends[0], w.ends[1]);
  }
  // Treat each device as a passthrough between its terminals so BFS can
  // walk QF.t1 → QF.t2 (different wires but same physical device) on its
  // way to the next bus.
  for (const el of elements) {
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
    const busesPerPin = new Map<string, Set<BusId>>();
    for (const startRef of myRefs) {
      const startPin = startRef.slice(el.id.length + 1);
      busesPerPin.set(startPin, new Set());
      const forbidden = new Set<WireEnd>(myRefs.filter((r) => r !== startRef));
      const visited = new Set<WireEnd>([startRef]);
      const queue: WireEnd[] = [startRef];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        if (isBus(cur)) {
          busesPerPin.get(startPin)!.add(cur);
          // Don't expand bus further — every bus reachable, not other taps.
          continue;
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
    const distinctBuses = new Set<BusId>();
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

  // ---- 1b'. Reclassify direct-tap horizontal linkers as vertical --------
  // Stage 1 defaults non-transformer direct-tap linkers to 'horizontal',
  // which suits a true bus tie between same-voltage bars. But the same
  // structure appears in the common main-panel-feeding-subpanel case (a
  // breaker directly tapped to both the main bus and the subpanel bus),
  // where the relationship is hierarchical, not lateral.
  //
  // Heuristic: if exactly one of the linker's buses can reach a source
  // element WITHOUT traversing this linker, the linker is a feeder
  // (vertical) — the stranded bus is downstream. If both sides are
  // independently sourced, it's a real bus tie and stays horizontal.
  const reachesSourceBypassing = (
    startBusId: BusId,
    linkerId: ElementId,
  ): boolean => {
    const linkerLib = libOf(linkerId);
    const blocked: WireEnd[] = linkerLib
      ? linkerLib.terminals.map((t) => `${linkerId}.${t.id}` as TerminalRef)
      : [];
    const startRef = startBusId as WireEnd;
    const visited = new Set<WireEnd>([startRef, ...blocked]);
    const queue: WireEnd[] = [startRef];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const dot = cur.indexOf('.');
      if (dot > 0) {
        const elemId = cur.slice(0, dot);
        const el = elementById.get(elemId);
        if (el) {
          const cat = library.get(el.kind)?.category;
          if (cat && SOURCE_CATEGORIES.has(cat)) return true;
        }
      }
      const neighbors = refAdj.get(cur);
      if (!neighbors) continue;
      for (const nb of neighbors) {
        if (visited.has(nb)) continue;
        visited.add(nb);
        queue.push(nb);
      }
    }
    return false;
  };

  for (const link of linkers) {
    if (link.orientation !== 'horizontal') continue;
    const busesInLink = new Set(link.attachments.map((a) => a.busId));
    let reachable = 0;
    for (const bid of busesInLink) {
      if (reachesSourceBypassing(bid, link.elementId)) reachable++;
    }
    if (reachable === 1) {
      link.orientation = 'vertical';
      linkerIds.add(link.elementId);
    }
  }

  // ---- 1c. Transitive horizontal-linker detection (bus-tie breakers) -----
  // A breaker bridging two buses through chains on each side — without a
  // transformer in either chain — is a bus tie / bus coupler. Detection is
  // restricted to kind='breaker' to avoid flooding the linker set with every
  // disconnector in a chain.
  for (const el of elements) {
    if (linkerIds.has(el.id)) continue;
    if (el.kind !== 'breaker') continue;
    const lib = library.get(el.kind);
    if (!lib || lib.terminals.length !== 2) continue;

    const myRefs = lib.terminals.map(
      (t) => `${el.id}.${t.id}` as TerminalRef,
    );
    const busPerPin = new Map<string, BusId>();

    for (const startRef of myRefs) {
      const startPin = startRef.slice(el.id.length + 1);
      const forbidden = new Set<WireEnd>(myRefs.filter((r) => r !== startRef));
      const visited = new Set<WireEnd>([startRef]);
      const queue: WireEnd[] = [startRef];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        if (isBus(cur)) {
          busPerPin.set(startPin, cur);
          break;
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
  const busLinks = new Map<BusId, Map<BusId, LinkerInfo>>();
  for (const b of busList) busLinks.set(b.id, new Map());
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

  const rootBuses: BusId[] = [];
  for (const bus of busList) {
    const refs = effectiveTaps.get(bus.id);
    if (!refs) continue;
    for (const ref of refs) {
      if (isBus(ref)) continue;
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
  if (rootBuses.length === 0 && busList.length > 0) rootBuses.push(busList[0].id);

  const busLevel = new Map<BusId, number>();
  for (const r of rootBuses) busLevel.set(r, 0);
  {
    const bfsQ: BusId[] = [...rootBuses];
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
  for (const bus of busList) {
    if (busLevel.has(bus.id)) continue;
    const maxLvl = busLevel.size === 0
      ? -1
      : Math.max(...Array.from(busLevel.values()));
    busLevel.set(bus.id, maxLvl + 1);
  }
  const levelToBuses = new Map<number, BusId[]>();
  for (const bus of busList) {
    const lvl = busLevel.get(bus.id)!;
    const arr = levelToBuses.get(lvl) ?? [];
    arr.push(bus.id);
    levelToBuses.set(lvl, arr);
  }
  const sortedLevels = [...levelToBuses.keys()].sort((a, b) => a - b);

  // ---- 3. Chain-extent helper -------------------------------------------
  interface ChainResult {
    extent: number;
    /** The chain element directly tapped to the bus (for X-alignment). */
    head?: ElementId;
  }
  const chainExtentToBus = (
    linker: LinkerInfo,
    busId: BusId,
    pinName: string,
  ): ChainResult => {
    const startRef = `${linker.elementId}.${pinName}` as TerminalRef;
    const targetRef = busId as WireEnd;
    const linkerLib = libOf(linker.elementId);
    const forbidden = new Set<WireEnd>();
    if (linkerLib) {
      for (const t of linkerLib.terminals) {
        if (t.id === pinName) continue;
        forbidden.add(`${linker.elementId}.${t.id}` as TerminalRef);
      }
    }
    const visited = new Set<WireEnd>([startRef]);
    const queue: { ref: WireEnd; dist: number }[] = [
      { ref: startRef, dist: 0 },
    ];
    const parent = new Map<WireEnd, WireEnd>();
    const enqueue = (other: WireEnd, ref: WireEnd, addDist: number, dist: number) => {
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
            // Direct-tap linker: skip self-as-head so callers fall through
            // to the slot-based fallback (linkerSlotX).
            if (headId !== linker.elementId) head = headId;
          }
        }
        return { extent: dist, head };
      }
      const dot = ref.indexOf('.');
      if (dot < 0) {
        // Bare bus id reached (not the target): don't expand through it.
        continue;
      }
      const elId = ref.slice(0, dot);
      const pin = ref.slice(dot + 1);
      // Passthrough through a non-bus, non-linker element: enqueue its other
      // terminals with the local pin-to-pin distance added.
      if (!isBus(elId) && !linkerIds.has(elId)) {
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
      // Cross to other ends via electrical-node membership. Edges incident
      // to a bus end contribute BUS_TAP_OFFSET (the wire stub between bus
      // line and the tap pin); inter-element edges contribute CHAIN_GAP.
      for (const g of pinToGroups.get(ref) ?? []) {
        for (const other of g) {
          if (other === ref) continue;
          if (visited.has(other) || forbidden.has(other)) continue;
          const isBusEdge = isBus(ref) || isBus(other);
          enqueue(other, ref, isBusEdge ? BUS_TAP_OFFSET : CHAIN_GAP, dist);
        }
      }
    }
    return { extent: 0 };
  };

  const gapBetween = (idA: BusId, idB: BusId): number => {
    const link = busLinks.get(idA)?.get(idB);
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
    const upperChain = chainExtentToBus(link, idA, pinAName).extent;
    const lowerChain = chainExtentToBus(link, idB, pinBName).extent;
    return upperChain + pinSpan + lowerChain;
  };

  // ---- Linker → upper-bus tap representative ----------------------------
  interface LinkerRep {
    lowerBusId: BusId;
  }
  const linkerUpperRep = new Map<ElementId, LinkerRep>();
  for (const link of linkers) {
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

  // ---- Stage-6 subtree fan-width estimate -------------------------------
  // Mirrors the parallel-branch placement in stage 6: starting from a bus
  // tap, walk the device graph *away* from the bus and estimate the maximum
  // lateral width the tap's subtree will occupy. A CT that fans out to a
  // load + an earthing-switch needs a wider bus slot than its own symbol so
  // adjacent taps' subtrees don't collide. Conservative (an upper bound on
  // one level's fan); deeper nesting takes the max over levels.
  const SUBTREE_GAP = 30;
  const elementWidth = (elId: ElementId): number => {
    const lib = libOf(elId);
    return Math.max(lib?.width ?? MIN_TAP_SPACING, MIN_TAP_SPACING);
  };
  // Cap recursion depth so a deep distribution chain (e.g. a horizontal
  // daisy-chain of MCBs each feeding an outlet) doesn't sum into an enormous
  // bus-span reservation. Two levels is enough to size the common case — a
  // CT fanning to a load + an earthing-switch — which is what scenario C
  // needs; deeper structure is reconciled by the later collision / repack
  // passes instead.
  const BRANCH_MAX_DEPTH = 2;
  const branchWidth = (
    fromRef: WireEnd,
    elId: ElementId,
    guard: Set<ElementId>,
    depth = 0,
  ): number => {
    const lib = libOf(elId);
    let own = elementWidth(elId);
    if (lib && !guard.has(elId) && depth < BRANCH_MAX_DEPTH) {
      guard.add(elId);
      // Collect the downstream node(s): for each terminal other than the one
      // facing `fromRef`, find the electrical node and its unplaced device
      // members (the would-be stage-6 siblings).
      let widest = 0;
      for (const term of lib.terminals) {
        const ref = `${elId}.${term.id}` as TerminalRef;
        if (ref === fromRef) continue;
        for (const g of pinToGroups.get(ref) ?? []) {
          const childEls = new Set<ElementId>();
          let touchesBus = false;
          for (const member of g) {
            if (member === ref) continue;
            if (isBus(member)) { touchesBus = true; continue; }
            const d = member.indexOf('.');
            if (d < 0) continue;
            const cid = member.slice(0, d);
            if (cid === elId || guard.has(cid) || linkerIds.has(cid)) continue;
            childEls.add(cid);
          }
          if (touchesBus || childEls.size === 0) continue;
          let sum = 0;
          for (const cid of childEls) {
            const childMemberRef = [...g].find(
              (mm) => mm.indexOf('.') > 0 && mm.slice(0, mm.indexOf('.')) === cid,
            ) as WireEnd | undefined;
            sum +=
              (childMemberRef
                ? branchWidth(childMemberRef, cid, guard, depth + 1)
                : elementWidth(cid)) + SUBTREE_GAP;
          }
          widest = Math.max(widest, sum - SUBTREE_GAP);
        }
      }
      guard.delete(elId);
      own = Math.max(own, widest);
    }
    return own;
  };

  // ---- Bottom-up bus span computation -----------------------------------
  const BUS_MIN_SPAN = 320;
  const busSpan = new Map<BusId, number>();
  const isLinkerLowerSide = (
    elId: ElementId,
    busId: BusId,
  ): boolean => {
    if (!linkerIds.has(elId)) return false;
    const link = linkers.find((l) => l.elementId === elId);
    const otherBusAtt = link?.attachments.find((a) => a.busId !== busId);
    if (!otherBusAtt) return false;
    const myLvl = busLevel.get(busId) ?? 0;
    const otherLvl = busLevel.get(otherBusAtt.busId) ?? 0;
    return otherLvl < myLvl;
  };
  const slotWidthFor = (
    elId: ElementId,
    libWidth: number,
    busFacingRef?: WireEnd,
  ): number => {
    const rep = linkerUpperRep.get(elId);
    if (rep) {
      const childSpan = busSpan.get(rep.lowerBusId);
      if (childSpan !== undefined) {
        return Math.max(libWidth, childSpan + MIN_TAP_SPACING);
      }
    }
    // Reserve room for the tap's stage-6 subtree fan-out, so a CT feeding a
    // load + earthing-switch gets a wide enough slot that neighbouring taps'
    // children don't collide.
    let sub = 0;
    if (busFacingRef) sub = branchWidth(busFacingRef, elId, new Set());
    return Math.max(libWidth, MIN_TAP_SPACING, sub);
  };
  const computeSpan = (busId: BusId, visiting: Set<BusId>): number => {
    if (busSpan.has(busId)) return busSpan.get(busId)!;
    if (visiting.has(busId)) return BUS_MIN_SPAN; // cycle guard
    visiting.add(busId);
    const tapRefs = effectiveTaps.get(busId) ?? [];
    let aboveW = 0;
    let belowW = 0;
    for (const ref of tapRefs) {
      if (isBus(ref)) continue;
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
        computeSpan(rep.lowerBusId, visiting);
      }
      const slotW = slotWidthFor(
        elId,
        lib.width,
        `${elId}.${pin}` as TerminalRef,
      );
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
  for (const bus of busList) computeSpan(bus.id, new Set());

  // ---- 3-5. Tier-based bus / tap / linker placement ---------------------
  const linkerSlotX = new Map<ElementId, number>();

  interface TapEntry {
    elId: ElementId;
    lib: LibraryEntry;
    localTerm: { id: string; x: number; y: number; orientation: Orientation };
    isLinker: boolean;
    busFacingRef: TerminalRef;
  }

  // Find the X of the closest other-bus that this tap reaches via the
  // electrical-node graph. Returned only if that bus has already been
  // placed.
  const tapPreferredX = (
    busId: BusId,
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
    const visited = new Set<WireEnd>([tapRef, ...startRefs]);
    const queue: WireEnd[] = startRefs.slice();
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (isBus(cur) && cur !== busId) {
        const geom = busLayout.get(cur);
        return geom ? geom.at[0] : undefined;
      }
      for (const g of pinToGroups.get(cur) ?? []) {
        for (const other of g) {
          if (other === cur || visited.has(other)) continue;
          visited.add(other);
          queue.push(other);
        }
      }
      const dot = cur.indexOf('.');
      if (dot > 0) {
        const elemId = cur.slice(0, dot);
        if (!isBus(elemId)) {
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

  const distributeBusTaps = (busId: BusId): void => {
    const tapRefs = effectiveTaps.get(busId);
    if (!tapRefs || tapRefs.length === 0) return;
    const geom = busLayout.get(busId);
    if (!geom) return;

    const remaining: TapEntry[] = tapRefs.flatMap((ref): TapEntry[] => {
      if (isBus(ref)) return [];
      const dot = ref.indexOf('.');
      if (dot < 0) return [];
      const elId = ref.slice(0, dot);
      const pin = ref.slice(dot + 1);
      if (layout.has(elId)) return [];
      if (isLinkerLowerSide(elId, busId)) return [];
      const lib = libOf(elId);
      if (!lib) return [];
      const localTerm = lib.terminals.find((t) => t.id === pin);
      if (!localTerm) return [];
      return [{
        elId,
        lib,
        localTerm,
        isLinker: linkerIds.has(elId),
        busFacingRef: `${elId}.${pin}` as TerminalRef,
      }];
    });
    if (remaining.length === 0) return;

    const aboveSide: TapEntry[] = [];
    const belowSide: TapEntry[] = [];
    for (const r of remaining) {
      if (r.localTerm.y > 0) aboveSide.push(r);
      else belowSide.push(r);
    }

    const sideTotalWidth = (group: TapEntry[]): number =>
      group.reduce(
        (s, r) => s + slotWidthFor(r.elId, r.lib.width, r.busFacingRef),
        0,
      );
    const requiredSpan =
      Math.max(sideTotalWidth(aboveSide), sideTotalWidth(belowSide)) +
      MIN_TAP_SPACING;
    const span = Math.max(geom.span, requiredSpan);
    if (span !== geom.span) {
      busLayout.set(busId, { ...geom, span });
    }
    const finalGeom = busLayout.get(busId)!;

    const distribute = (group: TapEntry[], offsetSign: -1 | 1): void => {
      if (group.length === 0) return;
      const prefByEl = new Map<ElementId, number>();
      for (const r of group) {
        const px = tapPreferredX(busId, r.elId, r.localTerm.id);
        if (px !== undefined) prefByEl.set(r.elId, px);
      }
      group.sort((a, b) => {
        const ax = prefByEl.get(a.elId) ?? finalGeom.at[0];
        const bx = prefByEl.get(b.elId) ?? finalGeom.at[0];
        if (ax !== bx) return ax - bx;
        // Same-preference taps: wider slots toward bus center, narrow ones
        // pushed to the extreme. Lets a small bus-tie disconnector land on
        // the actual edge even when a wide transformer-feeding slot wants
        // the same side.
        const aw = slotWidthFor(a.elId, a.lib.width, a.busFacingRef);
        const bw = slotWidthFor(b.elId, b.lib.width, b.busFacingRef);
        return bw - aw;
      });
      const widths = group.map((r) =>
        slotWidthFor(r.elId, r.lib.width, r.busFacingRef),
      );
      const totalW = widths.reduce((s, w) => s + w, 0);
      const usableSpan = Math.max(span, totalW);
      const slotGap = (usableSpan - totalW) / (group.length + 1);
      let cursor = finalGeom.at[0] - usableSpan / 2 + slotGap;
      const tapWorldY = finalGeom.at[1] + offsetSign * BUS_TAP_OFFSET;
      for (let i = 0; i < group.length; i++) {
        const r = group[i];
        const slotW = widths[i];
        const tapWorldX = cursor + slotW / 2;
        if (r.isLinker) {
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
    if (link.orientation === 'horizontal') return;
    const linkerLib = libOf(link.elementId);
    if (!linkerLib) return;

    const placedAttachments = link.attachments.filter((a) =>
      busLayout.has(a.busId),
    );
    if (placedAttachments.length < 2) return;
    const sorted = placedAttachments.slice().sort(
      (a, b) =>
        (busLevel.get(a.busId) ?? 0) - (busLevel.get(b.busId) ?? 0),
    );
    const upperBusId = sorted[0].busId;
    const upperGeom = busLayout.get(upperBusId)!;

    const upperPin = sorted[0].pin;
    const lowerPin = sorted[sorted.length - 1].pin;
    const upperLocal = linkerLib.terminals.find((t) => t.id === upperPin);
    const lowerLocal = linkerLib.terminals.find((t) => t.id === lowerPin);
    if (!upperLocal || !lowerLocal) return;

    const rot: 0 | 180 = upperLocal.y <= lowerLocal.y ? 0 : 180;

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
      } else if (linkerSlotX.has(link.elementId)) {
        // Direct-tap linker (no intermediate chain head): use the slot X
        // allocated for it by the upper bus's tap distribution.
        upperHeadXs.push(linkerSlotX.get(link.elementId)!);
      } else {
        upperHeadXs.push(busLayout.get(att.busId)!.at[0]);
      }
    }
    let xCenter: number;
    if (upperHeadXs.length > 0) {
      xCenter =
        upperHeadXs.reduce((s, x) => s + x, 0) / upperHeadXs.length;
    } else if (linkerSlotX.has(link.elementId)) {
      xCenter = linkerSlotX.get(link.elementId)!;
    } else {
      xCenter = upperGeom.at[0];
    }
    const upperPinWorldY = upperGeom.at[1] + maxUpperExtent;

    const at: [number, number] =
      rot === 0
        ? [snap(xCenter - upperLocal.x), snap(upperPinWorldY - upperLocal.y)]
        : [snap(xCenter + upperLocal.x), snap(upperPinWorldY + upperLocal.y)];
    layout.set(link.elementId, { at, rot, mirror: false });

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

  // Walk a single-pin chain starting from `startRef`, heading in the world
  // `startExit` direction. Stops at a merge node (electrical node with 3+
  // members), a bus, a linker, an already-placed element, or no neighbour.
  const walkChainAlongAxis = (
    startRef: TerminalRef,
    startWorld: [number, number],
    startExit: Orientation,
    axisX: number,
  ): void => {
    const visited = new Set<WireEnd>([startRef]);
    let prevRef: WireEnd = startRef;
    let prevWorld = startWorld;
    let prevExit = startExit;
    while (true) {
      const groups = pinToGroups.get(prevRef) ?? [];
      let nextRef: WireEnd | undefined;
      let blocked = false;
      for (const g of groups) {
        if (g.length >= 3) {
          // Multi-pin merge — stop and let auto-route draw the rake.
          blocked = true;
          break;
        }
        const other = g.find((r) => r !== prevRef);
        if (!other || visited.has(other)) continue;
        if (isBus(other)) {
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
      if (isBus(elId) || linkerIds.has(elId)) break;
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
      const at: [number, number] = [
        snap(axisX - rotatedInPin[0]),
        snap(target[1] - rotatedInPin[1]),
      ];
      layout.set(elId, { at, rot, mirror: false });
      visited.add(nextRef);

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

  const placeHorizontalLinker = (link: LinkerInfo): void => {
    if (layout.has(link.elementId)) return;
    if (link.orientation !== 'horizontal') return;
    const linkerLib = libOf(link.elementId);
    if (!linkerLib) return;
    const placed = link.attachments.filter((a) => busLayout.has(a.busId));
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
        : busLayout.get(att.busId)!.at[0];
      return { att, x, extent: result.extent };
    });
    heads.sort((a, b) => a.x - b.x);
    const left = heads[0];
    const right = heads[heads.length - 1];
    const leftLocal = linkerLib.terminals.find((t) => t.id === left.att.pin);
    const rightLocal = linkerLib.terminals.find((t) => t.id === right.att.pin);
    if (!leftLocal || !rightLocal) return;

    const rot: 90 | 270 = leftLocal.y <= rightLocal.y ? 270 : 90;

    const xCenter = (left.x + right.x) / 2;
    const busY = busLayout.get(left.att.busId)!.at[1];
    const linkerY = busY + Math.max(left.extent, right.extent);

    layout.set(link.elementId, {
      at: [snap(xCenter), snap(linkerY)],
      rot,
      mirror: false,
    });
  };

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
      if (maxGap === 0) maxGap = MIN_BUS_GAP_Y;
      levelY = prevLevelY + maxGap;
    }
    prevLevelY = levelY;

    let nextSiblingX = BUS_X;
    for (const busId of busIdsAtLevel) {
      if (busLayout.has(busId)) {
        prevLevelY = Math.max(prevLevelY, busLayout.get(busId)!.at[1]);
        continue;
      }
      let busX: number | undefined;
      if (li > 0) {
        const prevBusIds = levelToBuses.get(sortedLevels[li - 1])!;
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
            headXs.push(busLayout.get(parent)!.at[0]);
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
      const span = busSpan.get(busId) ?? DEFAULT_BUS_SPAN;
      busLayout.set(busId, {
        at: [snap(busX), snap(levelY)],
        rot: 0,
        span,
        axis: busAxisFromRot(0),
      });
    }

    for (const busId of busIdsAtLevel) {
      distributeBusTaps(busId);
    }

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

  // ---- 5b. No-bus seeding -----------------------------------------------
  // Bus-less diagrams (a string inverter, a DC charger, a small genset feed)
  // have no anchor, so without help every element falls into the lower-right
  // fallback grid. Seed one root per connected device component so the
  // parallel-branch pass below can grow a top-to-bottom chain from it. The
  // root is a source-category element when present (laid out feeding
  // downward), else the element whose connected pin exits downward / the
  // first by id — picked deterministically.
  if (busList.length === 0 && layout.size < elements.length) {
    const deviceAdj = (elId: ElementId): Set<ElementId> => {
      const out = new Set<ElementId>();
      const lib = libOf(elId);
      if (!lib) return out;
      for (const t of lib.terminals) {
        const ref = `${elId}.${t.id}` as TerminalRef;
        for (const g of pinToGroups.get(ref) ?? []) {
          for (const member of g) {
            if (member === ref || isBus(member)) continue;
            const d = member.indexOf('.');
            if (d < 0) continue;
            const other = member.slice(0, d);
            if (other !== elId) out.add(other);
          }
        }
      }
      return out;
    };
    // Connected components over the device graph.
    const seen = new Set<ElementId>();
    const components: ElementId[][] = [];
    for (const el of elements) {
      if (seen.has(el.id) || !libOf(el.id)) continue;
      // Only seed components with ≥2 connected devices; true orphans go to
      // the fallback grid as before.
      const comp: ElementId[] = [];
      const stack = [el.id];
      seen.add(el.id);
      while (stack.length > 0) {
        const cur = stack.pop()!;
        comp.push(cur);
        for (const nb of deviceAdj(cur)) {
          if (seen.has(nb)) continue;
          seen.add(nb);
          stack.push(nb);
        }
      }
      if (comp.length >= 2) components.push(comp);
    }

    let columnX = BUS_X;
    for (const comp of components) {
      if (comp.some((id) => layout.has(id))) continue;
      // Root preference: a source, else the element with the fewest device
      // neighbours (a chain end), tie-broken by id for determinism.
      comp.sort((a, b) => {
        const sa = isSourceKind(elementById.get(a)?.kind ?? '') ? 0 : 1;
        const sb = isSourceKind(elementById.get(b)?.kind ?? '') ? 0 : 1;
        if (sa !== sb) return sa - sb;
        const da = deviceAdj(a).size;
        const db = deviceAdj(b).size;
        if (da !== db) return da - db;
        return a.localeCompare(b);
      });
      const rootId = comp[0];
      const rootLib = libOf(rootId);
      if (!rootLib) continue;
      // Place the root so its downward-exiting pin (or its lowest pin) sits at
      // the column; stage 6 grows the rest below it.
      const lowestTerm = rootLib.terminals
        .slice()
        .sort((a, b) => b.y - a.y)[0];
      const px = lowestTerm
        ? transformPoint([lowestTerm.x, lowestTerm.y], {
            at: [0, 0],
            rot: 0,
            mirror: false,
          })
        : [0, 0];
      layout.set(rootId, {
        at: [snap(columnX - px[0]), snap(BUS_Y0 - px[1])],
        rot: 0,
        mirror: false,
      });
      // Advance the column for the next component, leaving room for its fan.
      columnX += Math.max(DEFAULT_BUS_SPAN, comp.length * MIN_TAP_SPACING) +
        SIBLING_X_GAP;
    }
  }

  // ---- 6. Node-based parallel-branch placement --------------------------
  // For each electrical node with placed and unplaced members, pick the
  // anchor pin by voting on direct co-occurrence with the unplaced cluster,
  // and lay out the remaining elements as parallel branches perpendicular
  // to the anchor's exit. Iterate to a fixpoint so newly-placed elements
  // can anchor further chains.
  const isEndPlaced = (end: WireEnd): boolean => {
    if (isBus(end)) return busLayout.has(end);
    const dot = end.indexOf('.');
    if (dot < 0) return false;
    return layout.has(end.slice(0, dot));
  };

  let progressed = true;
  let safety = elements.length + 4;
  while (progressed && safety-- > 0) {
    progressed = false;

    for (const node of nodeGroups) {
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
      const unplacedByEl = new Map<ElementId, UnplacedPinInfo>();

      for (const end of node) {
        if (isBus(end)) {
          // Bus is a hyperedge node, not an anchor candidate.
          continue;
        }
        const dot = end.indexOf('.');
        if (dot < 0) continue;
        const id = end.slice(0, dot);
        const pinName = end.slice(dot + 1);
        if (layout.has(id)) {
          placedPins.push(end as TerminalRef);
          continue;
        }
        if (linkerIds.has(id)) continue;
        if (unplacedByEl.has(id)) continue;
        const lib = libOf(id);
        if (!lib) continue;
        const localTerm = lib.terminals.find((t) => t.id === pinName);
        if (!localTerm) continue;
        unplacedByEl.set(id, {
          ref: end as TerminalRef,
          elId: id,
          lib,
          localTerm,
        });
      }
      if (unplacedByEl.size === 0 || placedPins.length === 0) continue;
      const unplacedUnique = [...unplacedByEl.values()];

      // Vote on anchor: each unplaced pin contributes a vote to every other
      // placed non-bus pin in the same node. Strong winner = the placed pin
      // most directly connected to the unplaced cluster.
      const votes = new Map<TerminalRef, number>();
      for (const u of unplacedUnique) {
        for (const g of pinToGroups.get(u.ref) ?? []) {
          for (const p of g) {
            if (p === u.ref) continue;
            if (isBus(p)) continue;
            if (!isEndPlaced(p)) continue;
            const tref = p as TerminalRef;
            votes.set(tref, (votes.get(tref) ?? 0) + 1);
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

  // ---- 6b. Separate co-tier upper feeds into the same bus ---------------
  // Two independent feeds (e.g. a utility transformer chain and a backup
  // generator/source chain, or a source chain and a parent-bus transformer
  // drop) can resolve to the same X-column and overlap completely. Group the
  // placed devices that feed each bus *from above* into connected feed
  // components, then push overlapping siblings apart laterally across the
  // bus span. Only horizontal translation is applied, so vertical chain
  // structure is preserved.
  const worldXRange = (
    elId: ElementId,
  ): { min: number; max: number } | null => {
    const place = layout.get(elId);
    const lib = libOf(elId);
    if (!place || !lib) return null;
    const parts = lib.viewBox.split(/\s+/).map(Number);
    if (parts.length < 4 || parts.some((n) => Number.isNaN(n))) {
      // Fall back to width centred on origin.
      const half = lib.width / 2;
      return { min: place.at[0] - half, max: place.at[0] + half };
    }
    const [vx, vy, vw, vh] = parts;
    const corners: [number, number][] = [
      [vx, vy],
      [vx + vw, vy],
      [vx, vy + vh],
      [vx + vw, vy + vh],
    ];
    let mn = Infinity;
    let mx = -Infinity;
    for (const c of corners) {
      const w = transformPoint(c, place);
      mn = Math.min(mn, w[0]);
      mx = Math.max(mx, w[0]);
    }
    return { min: mn, max: mx };
  };

  // Device adjacency (no passthrough, no bus crossing) for feed grouping.
  const deviceNeighbors = (elId: ElementId): Set<ElementId> => {
    const out = new Set<ElementId>();
    const lib = libOf(elId);
    if (!lib) return out;
    for (const t of lib.terminals) {
      const ref = `${elId}.${t.id}` as TerminalRef;
      for (const g of pinToGroups.get(ref) ?? []) {
        for (const member of g) {
          if (member === ref || isBus(member)) continue;
          const d = member.indexOf('.');
          if (d < 0) continue;
          const other = member.slice(0, d);
          if (other !== elId) out.add(other);
        }
      }
    }
    return out;
  };

  const FEED_GAP = 40;
  const worldYRange = (
    elId: ElementId,
  ): { min: number; max: number } | null => {
    const place = layout.get(elId);
    const lib = libOf(elId);
    if (!place || !lib) return null;
    const parts = lib.viewBox.split(/\s+/).map(Number);
    if (parts.length < 4 || parts.some((n) => Number.isNaN(n))) {
      const half = lib.height / 2;
      return { min: place.at[1] - half, max: place.at[1] + half };
    }
    const [vx, vy, vw, vh] = parts;
    const corners: [number, number][] = [
      [vx, vy],
      [vx + vw, vy],
      [vx, vy + vh],
      [vx + vw, vy + vh],
    ];
    let mn = Infinity;
    let mx = -Infinity;
    for (const c of corners) {
      const w = transformPoint(c, place);
      mn = Math.min(mn, w[1]);
      mx = Math.max(mx, w[1]);
    }
    return { min: mn, max: mx };
  };

  // For each bus, gather the devices feeding it from above (its connected
  // upper region) and resolve any symbol overlaps by shifting the smaller of
  // the two colliding sub-branches sideways. This catches both two
  // independent feeds (utility transformer + backup generator) AND two chains
  // splitting off a shared anchor (an ATS feeding two source chains). Only
  // horizontal translation is applied; vertical chain structure is preserved.
  const upperRegionOf = (busId: BusId, busY: number): Set<ElementId> => {
    const region = new Set<ElementId>();
    const stack: ElementId[] = [];
    for (const ref of effectiveTaps.get(busId) ?? []) {
      if (isBus(ref)) continue;
      const d = ref.indexOf('.');
      if (d < 0) continue;
      const elId = ref.slice(0, d);
      const place = layout.get(elId);
      if (!place || place.at[1] >= busY - 1) continue;
      if (!region.has(elId)) {
        region.add(elId);
        stack.push(elId);
      }
    }
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const nb of deviceNeighbors(cur)) {
        if (region.has(nb)) continue;
        const place = layout.get(nb);
        if (!place || place.at[1] >= busY - 1) continue;
        region.add(nb);
        stack.push(nb);
      }
    }
    return region;
  };

  // Devices on `a`'s side of the graph once `b` is removed (and that stay
  // within `region`). Used to decide which sub-branch to shift.
  const exclusiveSide = (
    a: ElementId,
    b: ElementId,
    region: Set<ElementId>,
  ): Set<ElementId> => {
    const seen = new Set<ElementId>([a]);
    const stack = [a];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const nb of deviceNeighbors(cur)) {
        if (nb === b || seen.has(nb) || !region.has(nb)) continue;
        seen.add(nb);
        stack.push(nb);
      }
    }
    return seen;
  };

  // Resolve symbol overlaps within `members` by shifting the smaller
  // exclusive sub-branch of each colliding pair sideways. `region` bounds the
  // sub-branch search so shifts stay local. Returns whether anything moved.
  const resolveOverlaps = (
    members: ElementId[],
    region: Set<ElementId>,
  ): boolean => {
    let iter = members.length * members.length + 8;
    let anyShift = false;
    let collided = true;
    while (collided && iter-- > 0) {
      collided = false;
      for (let i = 0; i < members.length && !collided; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const a = members[i];
          const b = members[j];
          const ax = worldXRange(a);
          const bx = worldXRange(b);
          const ay = worldYRange(a);
          const by = worldYRange(b);
          if (!ax || !bx || !ay || !by) continue;
          const oxOverlap =
            Math.min(ax.max, bx.max) - Math.max(ax.min, bx.min);
          const oyOverlap =
            Math.min(ay.max, by.max) - Math.max(ay.min, by.min);
          if (oxOverlap <= 0 || oyOverlap <= 0) continue;

          // Shift the smaller exclusive sub-branch sideways to clear.
          const sideA = exclusiveSide(a, b, region);
          const sideB = exclusiveSide(b, a, region);
          // If removing the partner doesn't separate them, they're on a cycle
          // / shared rake — skip (can't cleanly split).
          if (sideA.has(b) || sideB.has(a)) continue;
          const aCenter = (ax.min + ax.max) / 2;
          const bCenter = (bx.min + bx.max) / 2;
          // Move the smaller side; ties → move the right-hand one rightward.
          let moveSet: Set<ElementId>;
          let dir: 1 | -1;
          if (sideA.size <= sideB.size) {
            moveSet = sideA;
            dir = aCenter <= bCenter ? -1 : 1;
          } else {
            moveSet = sideB;
            dir = bCenter <= aCenter ? -1 : 1;
          }
          const clear =
            Math.max(ax.max, bx.max) - Math.min(ax.min, bx.min);
          const dx = snap(dir * (clear + FEED_GAP));
          if (dx === 0) continue;
          for (const elId of moveSet) {
            const place = layout.get(elId);
            if (!place) continue;
            layout.set(elId, {
              ...place,
              at: [place.at[0] + dx, place.at[1]],
            });
          }
          anyShift = true;
          collided = true;
          break;
        }
      }
    }
    return anyShift;
  };

  for (const bus of busList) {
    const busGeom = busLayout.get(bus.id);
    if (!busGeom) continue;
    const region = upperRegionOf(bus.id, busGeom.at[1]);
    if (region.size < 2) continue;
    const members = [...region];
    const anyShift = resolveOverlaps(members, region);

    if (anyShift) {
      // Re-centre the upper region over the bus and widen the bus to cover it.
      let mn = Infinity;
      let mx = -Infinity;
      for (const elId of members) {
        const r = worldXRange(elId);
        if (!r) continue;
        mn = Math.min(mn, r.min);
        mx = Math.max(mx, r.max);
      }
      if (Number.isFinite(mn)) {
        const recenter = snap(busGeom.at[0] - (mn + mx) / 2);
        if (recenter !== 0) {
          for (const elId of members) {
            const place = layout.get(elId);
            if (!place) continue;
            layout.set(elId, {
              ...place,
              at: [place.at[0] + recenter, place.at[1]],
            });
          }
        }
        const spread = mx - mn + FEED_GAP;
        if (spread > busGeom.span) {
          const g = busLayout.get(bus.id)!;
          busLayout.set(bus.id, { ...g, span: spread });
        }
      }
    }
  }

  // Count symbol overlaps among placed devices — used to verify the repack
  // below didn't make things worse (it can, on diagrams with long horizontal
  // daisy-chains that don't fit the bus-tap model). Cheap O(n²) on the small
  // diagrams auto-layout runs on.
  const countOverlaps = (): number => {
    const ids = elements.map((e) => e.id).filter((id) => layout.has(id));
    const boxes = ids
      .map((id) => ({ x: worldXRange(id), y: worldYRange(id) }))
      .filter((b) => b.x && b.y) as {
      x: { min: number; max: number };
      y: { min: number; max: number };
    }[];
    let count = 0;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const ox =
          Math.min(boxes[i].x.max, boxes[j].x.max) -
          Math.max(boxes[i].x.min, boxes[j].x.min);
        const oy =
          Math.min(boxes[i].y.max, boxes[j].y.max) -
          Math.max(boxes[i].y.min, boxes[j].y.min);
        if (ox > 1 && oy > 1) count++;
      }
    }
    return count;
  };

  // ---- 6c. Tight horizontal repack of same-tier buses -------------------
  // Buses sharing a tier (e.g. phase/neutral bars, AC/DC rails, ring
  // segments — no source→transformer hierarchy between them) are positioned
  // by a running sibling cursor that uses each bus's *estimated* span. That
  // estimate over-allocates (the bottom-up span sums per-slot minimums and
  // subtree reservations), so a handful of independent bars can sprawl to
  // tens of thousands of px. After everything is placed we know the *actual*
  // extent each bus occupies, so re-pack each over-wide tier tightly using
  // real extents, translating each bus together with the devices it owns.
  // Guarded: snapshot first, and roll back if the repack introduces overlaps.
  const overlapsBeforeRepack = countOverlaps();
  const layoutSnapshot = new Map<ElementId, ResolvedPlacement>();
  for (const [id, p] of layout) layoutSnapshot.set(id, { ...p, at: [...p.at] });
  const busSnapshot = new Map<BusId, BusGeometry>();
  for (const [id, g] of busLayout)
    busSnapshot.set(id, { ...g, at: [...g.at] });
  const PACK_GAP = 120;
  // Owning bus for a placed device: the nearest bus by device-graph BFS.
  const ownerBus = new Map<ElementId, BusId>();
  {
    // Multi-source BFS from every bus simultaneously over the device graph
    // (devices passthrough; buses are sinks). First bus to reach a device
    // owns it; shared/equidistant devices stay unowned (left in place).
    const dist = new Map<ElementId, number>();
    const owner = new Map<ElementId, BusId | null>();
    const queue: { el: ElementId; bus: BusId; d: number }[] = [];
    for (const bus of busList) {
      for (const ref of effectiveTaps.get(bus.id) ?? []) {
        if (isBus(ref)) continue;
        const dot = ref.indexOf('.');
        if (dot < 0) continue;
        const elId = ref.slice(0, dot);
        if (!layout.has(elId)) continue;
        queue.push({ el: elId, bus: bus.id, d: 1 });
      }
    }
    queue.sort((a, b) => a.d - b.d);
    let qi = 0;
    while (qi < queue.length) {
      const { el, bus, d } = queue[qi++];
      const prev = dist.get(el);
      if (prev === undefined) {
        dist.set(el, d);
        owner.set(el, bus);
      } else if (d === prev && owner.get(el) !== bus) {
        owner.set(el, null); // tie → shared, unowned
        continue;
      } else {
        continue;
      }
      for (const nb of deviceNeighbors(el)) {
        if (!layout.has(nb)) continue;
        if (dist.has(nb)) continue;
        queue.push({ el: nb, bus, d: d + 1 });
      }
    }
    for (const [el, b] of owner) if (b) ownerBus.set(el, b);
  }

  for (const lvl of sortedLevels) {
    const idsAtLevel = (levelToBuses.get(lvl) ?? []).filter((b) =>
      busLayout.has(b),
    );
    if (idsAtLevel.length < 2) continue;

    // Actual extent of each bus = bus line (capped to its taps) ∪ owned
    // devices' x-ranges.
    interface BusExtent {
      busId: BusId;
      min: number;
      max: number;
      members: ElementId[];
    }
    const extents: BusExtent[] = [];
    let totalActual = 0;
    for (const busId of idsAtLevel) {
      const g = busLayout.get(busId)!;
      const members: ElementId[] = [];
      let mn = Infinity;
      let mx = -Infinity;
      for (const [el, b] of ownerBus) {
        if (b !== busId) continue;
        const r = worldXRange(el);
        if (!r) continue;
        members.push(el);
        mn = Math.min(mn, r.min);
        mx = Math.max(mx, r.max);
      }
      // Include the bus line span only as far as its owned devices need; if a
      // bus has no owned devices, keep a minimal stub centred on its line.
      if (!Number.isFinite(mn)) {
        mn = g.at[0] - BUS_MIN_SPAN / 2;
        mx = g.at[0] + BUS_MIN_SPAN / 2;
      }
      extents.push({ busId, min: mn, max: mx, members });
      totalActual += mx - mn;
    }
    // Current spread of this tier.
    let curMin = Infinity;
    let curMax = -Infinity;
    for (const e of extents) {
      curMin = Math.min(curMin, e.min);
      curMax = Math.max(curMax, e.max);
    }
    const curSpread = curMax - curMin;
    const packedSpread =
      totalActual + PACK_GAP * (extents.length - 1);
    // Only repack when it meaningfully tightens the tier (avoid churning
    // already-compact layouts).
    if (!(curSpread > packedSpread + PACK_GAP)) continue;

    extents.sort((a, b) => (a.min + a.max) / 2 - (b.min + b.max) / 2);
    let cursor = curMin;
    for (const e of extents) {
      const dx = snap(cursor - e.min);
      if (dx !== 0) {
        const g = busLayout.get(e.busId)!;
        busLayout.set(e.busId, { ...g, at: [g.at[0] + dx, g.at[1]] });
        for (const el of e.members) {
          const place = layout.get(el);
          if (!place) continue;
          layout.set(el, { ...place, at: [place.at[0] + dx, place.at[1]] });
        }
        e.min += dx;
        e.max += dx;
      }
      cursor = e.max + PACK_GAP;
    }
    // Cap each bus's drawn span to its (now-final) owned extent so the bus
    // line doesn't draw far past its taps.
    for (const e of extents) {
      const g = busLayout.get(e.busId)!;
      const want = Math.max(BUS_MIN_SPAN, e.max - e.min);
      if (want < g.span) {
        busLayout.set(e.busId, { ...g, span: want });
      }
    }
  }

  // ---- 6d. Final global overlap sweep -----------------------------------
  // The tight repack (6c) can abut device fans owned by adjacent buses; mop
  // up any residual symbol overlaps with the same shift-the-smaller-branch
  // resolver, this time over every placed device.
  {
    const allPlaced = elements
      .map((e) => e.id)
      .filter((id) => layout.has(id));
    const region = new Set(allPlaced);
    resolveOverlaps(allPlaced, region);
  }

  // Roll back the repack (6c) + its overlap mop-up (6d) if it left more
  // overlaps than before. A slightly wider but overlap-free layout beats a
  // tight one with stacked symbols.
  if (countOverlaps() > overlapsBeforeRepack) {
    layout.clear();
    for (const [id, p] of layoutSnapshot) layout.set(id, p);
    busLayout.clear();
    for (const [id, g] of busSnapshot) busLayout.set(id, g);
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

  return { devices: layout, buses: busLayout };
}

function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}
