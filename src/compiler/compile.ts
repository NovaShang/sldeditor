/**
 * DiagramFile → InternalModel. Pipeline:
 *
 *   1. Resolve elements + library
 *   2. Resolve buses (geometry from `Bus.layout` or auto-layout below)
 *   3. Validate wire endpoints (errors → diagnostics; pipeline keeps going)
 *   4. Auto-layout for devices without `Placement` and buses without layout
 *   5. Compute world-frame terminal geometry
 *   6. Union-find on wires → ConnectivityNode set with deterministic ids
 *      (sorted endpoints hashed) so `routes[nodeId]` keys stay stable
 *      across saves
 *   7. Auto-route each ConnectivityNode unless the user supplied a path
 */

import { t } from '../i18n';
import type {
  Bus,
  BusId,
  DiagramFile,
  Element,
  ElementId,
  NodeId,
  TerminalRef,
  Wire,
  WireEnd,
} from '../model';
import { normalizePath } from '../model/wire-path';
import { autoLayout } from './auto-layout';
import { routeWire, wireEndWorld } from './auto-route';
import { LIBRARY } from './library-index';
import {
  emptyInternalModel,
  resolvePlacement,
  busAxisFromRot,
  type BusGeometry,
  type InternalModel,
  type ResolvedPlacement,
} from './internal-model';
import { transformOrientation, transformPoint } from './transforms';
import { UnionFind } from './union-find';

/**
 * Stable, content-derived node id. Same set of endpoints always maps to the
 * same NodeId across compile runs and across save/load cycles, so user-edited
 * `routes[nodeId]` overrides stay attached after reload.
 */
function deterministicNodeId(members: WireEnd[]): NodeId {
  // FNV-1a 32-bit on the sorted, joined refs. Plenty of entropy for typical
  // diagram sizes (<10k nodes); collisions only cause a route override to
  // attach to the wrong node, never wrong electrical behavior.
  const sorted = [...members].sort();
  const text = sorted.join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `n_${(h >>> 0).toString(36)}`;
}

const DEFAULT_BUS_SPAN = 320;

export function compile(diagram: DiagramFile): InternalModel {
  const m = emptyInternalModel();

  // ---- 1. Resolve elements + library ------------------------------------
  const elementById = new Map<ElementId, Element>();
  diagram.elements.forEach((el, idx) => {
    if (elementById.has(el.id)) {
      m.diagnostics.push({
        code: 'E001',
        severity: 'error',
        message: t('compile.duplicateId', { id: el.id }),
        pointer: `/elements/${idx}`,
      });
      return;
    }
    elementById.set(el.id, el);
    const libDef = LIBRARY.get(el.kind);
    if (!libDef) {
      m.diagnostics.push({
        code: 'E003',
        severity: 'error',
        message: `${t('compile.unknownKind', { kind: el.kind })} (id=${el.id})`,
        pointer: `/elements/${idx}`,
      });
    }
    m.elements.set(el.id, { element: el, libraryDef: libDef });
  });

  // ---- 2. Resolve buses (preliminary; layout filled by auto-layout) -----
  const busById = new Map<BusId, Bus>();
  const userBusLayout = new Map<BusId, BusGeometry>();
  (diagram.buses ?? []).forEach((bus, idx) => {
    if (elementById.has(bus.id) || busById.has(bus.id)) {
      m.diagnostics.push({
        code: 'E001',
        severity: 'error',
        message: t('compile.duplicateId', { id: bus.id }),
        pointer: `/buses/${idx}`,
      });
      return;
    }
    busById.set(bus.id, bus);
    if (bus.layout) {
      const rot = bus.layout.rot ?? 0;
      userBusLayout.set(bus.id, {
        at: bus.layout.at,
        span: bus.layout.span,
        rot,
        axis: busAxisFromRot(rot),
      });
    }
  });

  // ---- 3. Validate wire endpoints ---------------------------------------
  const isBus = (end: WireEnd): boolean => !end.includes('.') && busById.has(end);
  const validEnd = (end: WireEnd, pointer: string): boolean => {
    if (isBus(end)) return true;
    const dot = end.indexOf('.');
    if (dot <= 0) {
      m.diagnostics.push({
        code: 'E003',
        severity: 'error',
        message: t('compile.invalidTermRef', { ref: end }),
        pointer,
      });
      return false;
    }
    const elemId = end.slice(0, dot);
    const pin = end.slice(dot + 1);
    const re = m.elements.get(elemId);
    if (!re) {
      m.diagnostics.push({
        code: 'E002',
        severity: 'error',
        message: t('compile.elementMissing', { id: elemId }),
        pointer,
      });
      return false;
    }
    if (!re.libraryDef) return false;
    if (!re.libraryDef.terminals.find((term) => term.id === pin)) {
      const avail = re.libraryDef.terminals.map((term) => term.id).join(', ');
      m.diagnostics.push({
        code: 'E003',
        severity: 'error',
        message: t('compile.missingPin', {
          id: elemId,
          kind: re.element.kind,
          pin,
          available: avail,
        }),
        pointer,
      });
      return false;
    }
    return true;
  };

  const validWires: Wire[] = [];
  (diagram.wires ?? []).forEach((w, i) => {
    const pointer = `/wires/${i}`;
    const a = validEnd(w.ends[0], pointer);
    const b = validEnd(w.ends[1], pointer);
    if (a && b) validWires.push(w);
  });

  // ---- 4. Auto-layout ----------------------------------------------------
  const userLayout = new Map<ElementId, ResolvedPlacement>();
  if (diagram.layout) {
    for (const [id, p] of Object.entries(diagram.layout)) {
      if (m.elements.has(id)) userLayout.set(id, resolvePlacement(p));
      else
        m.diagnostics.push({
          code: 'E004',
          severity: 'error',
          message: t('compile.layoutMissingElement', { id }),
          pointer: `/layout/${id}`,
        });
    }
  }
  const layoutResult = autoLayout({
    elements: diagram.elements,
    buses: diagram.buses ?? [],
    wires: validWires,
    library: LIBRARY,
    userLayout,
    userBusLayout,
  });
  m.layout = layoutResult.devices;
  for (const [busId, geom] of layoutResult.buses) {
    const bus = busById.get(busId);
    if (!bus) continue;
    m.buses.set(busId, { bus, geometry: geom });
  }
  // Any bus that still has no geometry (auto-layout couldn't position it)
  // gets a default. Defensive — shouldn't happen with non-empty wires.
  for (const [busId, bus] of busById) {
    if (m.buses.has(busId)) continue;
    m.buses.set(busId, {
      bus,
      geometry: {
        at: bus.layout?.at ?? [0, 0],
        span: bus.layout?.span ?? DEFAULT_BUS_SPAN,
        rot: bus.layout?.rot ?? 0,
        axis: busAxisFromRot(bus.layout?.rot ?? 0),
      },
    });
  }

  // ---- 5. Compute terminal geometry --------------------------------------
  for (const re of m.elements.values()) {
    if (!re.libraryDef) continue;
    const place = m.layout.get(re.element.id);
    if (!place) continue;
    const refs: TerminalRef[] = [];
    for (const lt of re.libraryDef.terminals) {
      const ref = `${re.element.id}.${lt.id}` as TerminalRef;
      const world = transformPoint([lt.x, lt.y], place);
      const orientation = transformOrientation(lt.orientation, place);
      m.terminals.set(ref, {
        ref,
        elementId: re.element.id,
        pin: lt.id,
        world,
        orientation,
      });
      refs.push(ref);
    }
    m.elementToTerminals.set(re.element.id, refs);
  }

  // ---- 6. Union-find over wires -----------------------------------------
  const uf = new UnionFind<WireEnd>();
  for (const w of validWires) {
    uf.add(w.ends[0]);
    uf.add(w.ends[1]);
    uf.union(w.ends[0], w.ends[1]);
  }
  for (const [, members] of uf.groups()) {
    const id = deterministicNodeId(members);
    m.nodes.set(id, { id, terminals: members });
    for (const end of members) m.terminalToNode.set(end, id);
  }

  // Warn about isolated elements / buses (no terminal in any node).
  for (const re of m.elements.values()) {
    const refs = m.elementToTerminals.get(re.element.id) ?? [];
    if (refs.length === 0) continue;
    const anyConnected = refs.some((r) => m.terminalToNode.has(r));
    if (!anyConnected) {
      m.diagnostics.push({
        code: 'W001',
        severity: 'warning',
        message: t('compile.elementUnconnected', { id: re.element.id }),
      });
    }
  }
  for (const busId of m.buses.keys()) {
    if (!m.terminalToNode.has(busId)) {
      m.diagnostics.push({
        code: 'W001',
        severity: 'warning',
        message: t('compile.elementUnconnected', { id: busId }),
      });
    }
  }

  // ---- 7. Per-wire rendering (Wire.path override; otherwise routeWire) ---
  for (const w of validWires) {
    if (w.path && w.path.length >= 2) {
      // Rebase endpoints to current terminal / bus positions so the wire
      // tracks its connected elements when they move. Any diagonal that
      // appears as a result is fixed by normalizePath (inserts L-corner).
      const stored = w.path;
      const approachA = stored.length >= 2 ? (stored[1] as [number, number]) : null;
      const approachB = stored.length >= 2 ? (stored[stored.length - 2] as [number, number]) : null;
      const endA = wireEndWorld(w.ends[0], approachA, m);
      const endB = wireEndWorld(w.ends[1], approachB, m);
      if (endA && endB) {
        const rebased: [number, number][] = [
          [endA[0], endA[1]],
          ...stored.slice(1, -1).map((p) => [p[0], p[1]] as [number, number]),
          [endB[0], endB[1]],
        ];
        const cleaned = normalizePath(rebased);
        if (cleaned.length >= 2) {
          m.wireRenders.set(w.id, { wireId: w.id, path: cleaned, userEdited: true });
          continue;
        }
      }
      // Endpoint resolution failed; fall back to auto-route below.
    }
    const r = routeWire(w, m);
    if (r) m.wireRenders.set(w.id, r);
  }

  return m;
}
