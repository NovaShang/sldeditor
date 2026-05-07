/**
 * DiagramFile → InternalModel. Pipeline mirrors `docs/data-model.md` §8:
 *
 *   1. Resolve elements + library
 *   2. Validate IDs / pins (errors → diagnostics; pipeline keeps going)
 *   3. Expand `bus.tap` shorthand into connection groups
 *   4. Union-find over all connection groups → ConnectivityNode set
 *   5. Auto-layout for elements without a `Placement`
 *   6. Compute world-frame terminal geometry
 *   7. Auto-route each ConnectivityNode unless the user supplied a path
 */

import type {
  DiagramFile,
  Element,
  ElementId,
  NodeId,
  TerminalRef,
} from '../model';
import { autoLayout } from './auto-layout';
import { autoRoute } from './auto-route';
import { LIBRARY } from './library-index';
import {
  emptyInternalModel,
  resolvePlacement,
  type ConnectivityNode,
  type InternalModel,
  type ResolvedPlacement,
} from './internal-model';
import { transformOrientation, transformPoint } from './transforms';
import { UnionFind } from './union-find';

interface ConnGroup {
  terminals: TerminalRef[];
  /** Optional explicit node ID supplied by the author. */
  node?: NodeId;
  /** Optional human name supplied by the author. */
  name?: string;
  pointer: string;
}

export function compile(diagram: DiagramFile): InternalModel {
  const m = emptyInternalModel();

  // ---- 1. Resolve elements + library ------------------------------------
  const elementById = new Map<ElementId, Element>();
  diagram.elements.forEach((el, idx) => {
    if (elementById.has(el.id)) {
      m.diagnostics.push({
        code: 'E001',
        severity: 'error',
        message: `元件 ID 重复: "${el.id}"`,
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
        message: `未知元件类型 kind="${el.kind}" (id=${el.id})`,
        pointer: `/elements/${idx}`,
      });
    }
    m.elements.set(el.id, { element: el, libraryDef: libDef });
  });

  // ---- 2. Build connection groups (incl. bus.tap expansion) -------------
  const groups: ConnGroup[] = [];

  diagram.elements.forEach((el, idx) => {
    if (el.kind !== 'busbar' || !Array.isArray(el.tap) || el.tap.length === 0) return;
    const lib = LIBRARY.get('busbar');
    if (!lib) return;
    const busTerms = lib.terminals.map(
      (t) => `${el.id}.${t.id}` as TerminalRef,
    );
    groups.push({
      terminals: [...busTerms, ...el.tap],
      pointer: `/elements/${idx}/tap`,
    });
  });

  (diagram.connections ?? []).forEach((c, i) => {
    const pointer = `/connections/${i}`;
    if (Array.isArray(c)) {
      groups.push({ terminals: c, pointer });
    } else {
      groups.push({
        terminals: c.terminals,
        node: c.node,
        name: c.name,
        pointer,
      });
    }
  });

  // ---- 3. Validate terminal references ----------------------------------
  const validRef = (ref: TerminalRef, pointer: string): boolean => {
    const dot = ref.indexOf('.');
    if (dot <= 0) {
      m.diagnostics.push({
        code: 'E003',
        severity: 'error',
        message: `非法端子引用 "${ref}"`,
        pointer,
      });
      return false;
    }
    const elemId = ref.slice(0, dot);
    const pin = ref.slice(dot + 1);
    const re = m.elements.get(elemId);
    if (!re) {
      m.diagnostics.push({
        code: 'E002',
        severity: 'error',
        message: `引用了不存在的元件 "${elemId}"`,
        pointer,
      });
      return false;
    }
    if (!re.libraryDef) return false;
    if (!re.libraryDef.terminals.find((t) => t.id === pin)) {
      const avail = re.libraryDef.terminals.map((t) => t.id).join(', ');
      m.diagnostics.push({
        code: 'E003',
        severity: 'error',
        message: `元件 "${elemId}" (kind=${re.element.kind}) 没有引脚 "${pin}"，可用引脚: ${avail}`,
        pointer,
      });
      return false;
    }
    return true;
  };

  const validGroups: ConnGroup[] = [];
  for (const g of groups) {
    const valid = g.terminals.filter((r) => validRef(r, g.pointer));
    if (valid.length < 2) {
      if (g.terminals.length === 1) {
        m.diagnostics.push({
          code: 'W002',
          severity: 'warning',
          message: `${g.pointer} 只包含一个端子，已忽略`,
          pointer: g.pointer,
        });
      }
      continue;
    }
    validGroups.push({ ...g, terminals: valid });
  }

  // ---- 4. Auto-layout ----------------------------------------------------
  const userLayout = new Map<ElementId, ResolvedPlacement>();
  if (diagram.layout) {
    for (const [id, p] of Object.entries(diagram.layout)) {
      if (m.elements.has(id)) userLayout.set(id, resolvePlacement(p));
      else
        m.diagnostics.push({
          code: 'E004',
          severity: 'error',
          message: `layout key "${id}" 引用了不存在的元件`,
          pointer: `/layout/${id}`,
        });
    }
  }
  m.layout = autoLayout({
    elements: diagram.elements,
    connections: diagram.connections ?? [],
    library: LIBRARY,
    userLayout,
  });

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

  // ---- 6. Union-find on validated groups --------------------------------
  const uf = new UnionFind<TerminalRef>();
  for (const g of validGroups) {
    g.terminals.forEach((r) => uf.add(r));
    for (let i = 1; i < g.terminals.length; i++) uf.union(g.terminals[0], g.terminals[i]);
  }

  // Pre-assign user-named node IDs to their roots so the iteration below
  // doesn't overwrite them. The `reservedIds` set lets the auto-counter skip
  // any ID a user already chose (e.g. the user named one node "n5", we don't
  // want auto-generation to also produce "n5").
  const rootToId = new Map<TerminalRef, NodeId>();
  for (const g of validGroups) {
    if (g.node && g.terminals.length > 0) {
      rootToId.set(uf.find(g.terminals[0]), g.node);
    }
  }
  const reservedIds = new Set<NodeId>(rootToId.values());

  let nodeCounter = 0;
  for (const [root, members] of uf.groups()) {
    let id = rootToId.get(root);
    if (!id) {
      do {
        id = `n${++nodeCounter}`;
      } while (reservedIds.has(id));
    }
    const node: ConnectivityNode = { id, terminals: members };
    for (const g of validGroups) {
      if (g.name && g.terminals.length > 0 && uf.find(g.terminals[0]) === root) {
        node.name = g.name;
        break;
      }
    }
    m.nodes.set(id, node);
    for (const ref of members) m.terminalToNode.set(ref, id);
  }

  // Warn about isolated elements (none of their terminals appears in any node).
  for (const re of m.elements.values()) {
    const refs = m.elementToTerminals.get(re.element.id) ?? [];
    if (refs.length === 0) continue;
    const anyConnected = refs.some((r) => m.terminalToNode.has(r));
    if (!anyConnected) {
      m.diagnostics.push({
        code: 'W001',
        severity: 'warning',
        message: `元件 "${re.element.id}" 没有任何连接`,
      });
    }
  }

  // ---- 7. Routes (user-provided override; otherwise auto-route) ---------
  const userRoutes = diagram.routes ?? {};
  for (const node of m.nodes.values()) {
    const userRoute = userRoutes[node.id];
    if (userRoute) {
      m.routes.set(node.id, { paths: [userRoute.path], manual: userRoute.manual });
    } else {
      m.routes.set(node.id, autoRoute(node, m));
    }
  }

  return m;
}

