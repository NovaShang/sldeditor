/**
 * Zustand store — the single source of truth for the editor.
 *
 * Mutation rule: the only way to change `diagram` is `dispatch(mutator)`.
 * `dispatch` snapshots the previous diagram onto an undo stack, applies the
 * mutation, recompiles, and clears the redo stack. Targeted helpers
 * (`moveElements`, `addConnection`, …) are thin wrappers around `dispatch`.
 *
 * Selection / tool / cursor state lives in the store too, but does *not*
 * participate in the undo stack — Figma convention: ephemeral UI state
 * doesn't pollute history.
 *
 * Viewport (pan/zoom) is deliberately *not* in the store: it lives on a DOM
 * ref to avoid React re-renders during gesture loops.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  compile,
  type InternalModel,
  type ResolvedPlacement,
} from '@/compiler';
import type { FileSession } from '@/lib/file-io';
import type {
  Connection,
  DiagramFile,
  Element,
  ElementId,
  NamedConnection,
  NodeId,
  Placement,
  TerminalRef,
} from '@/model';
import { newElementId } from './id-allocator';

const EMPTY_DIAGRAM: DiagramFile = { version: '1', elements: [] };
const HISTORY_LIMIT = 100;
const PASTE_OFFSET = 20;

/**
 * Self-contained snapshot of a copied selection. Placements are pre-resolved
 * (auto-layout positions baked in) so paste survives later edits to the
 * source diagram. Connections only include those whose terminals are all
 * within the selection — partial connections are dropped, matching what
 * users expect from "copy this group of elements".
 */
export interface ClipboardData {
  elements: Element[];
  placements: Record<ElementId, Placement>;
  connections: Connection[];
}

export type ToolId = 'select' | 'pan' | 'wire' | 'place' | 'busbar';

export interface EditorState {
  // ---- Document --------------------------------------------------------
  diagram: DiagramFile;
  internal: InternalModel;
  /** Currently associated on-disk file (set by open / save), if any. */
  fileSession: FileSession | null;

  // ---- Ephemeral UI state ---------------------------------------------
  activeTool: ToolId;
  /** When `activeTool === 'place'`, the kind to drop on click. */
  placeKind: string | null;
  /** When `activeTool === 'wire'` and the user has clicked one terminal. */
  wireFromTerminal: TerminalRef | null;
  /** When `activeTool === 'place'` and the user pressed down on a terminal,
   *  starting a drag-from-terminal placement. */
  placeFromTerminal: TerminalRef | null;
  /** When `activeTool === 'busbar'` and the user has pressed pointer down. */
  busbarDrawStart: [number, number] | null;
  /** Cursor in SVG coordinates; updated by tools' onPointerMove. */
  cursorSvg: [number, number] | null;
  selection: ElementId[];
  /** Selected ConnectivityNode (set by clicking a wire). Mutually exclusive
   *  with `selection` — selecting an element clears it and vice versa. */
  selectedNode: NodeId | null;

  // ---- History ---------------------------------------------------------
  past: DiagramFile[];
  future: DiagramFile[];

  // ---- Clipboard (ephemeral, not in history) --------------------------
  clipboard: ClipboardData | null;
  /** Bumped on each paste so successive pastes step further from origin. */
  clipboardPasteIndex: number;

  // ---- Mutation API ----------------------------------------------------
  /** Replace the entire diagram, clearing history (used for open/load). */
  setDiagram: (diagram: DiagramFile) => void;
  setFileSession: (session: FileSession | null) => void;
  loadDiagramFromFile: (diagram: DiagramFile, session: FileSession) => void;

  /** Apply a function to produce the next diagram, with undo support. */
  dispatch: (mutator: (d: DiagramFile) => DiagramFile, label?: string) => void;
  undo: () => void;
  redo: () => void;

  // ---- UI actions ------------------------------------------------------
  setActiveTool: (tool: ToolId, opts?: { placeKind?: string | null }) => void;
  setPlaceKind: (kind: string | null) => void;
  setWireFromTerminal: (ref: TerminalRef | null) => void;
  setPlaceFromTerminal: (ref: TerminalRef | null) => void;
  setBusbarDrawStart: (pt: [number, number] | null) => void;
  setCursorSvg: (pt: [number, number] | null) => void;

  setSelection: (ids: ElementId[]) => void;
  toggleInSelection: (id: ElementId) => void;
  clearSelection: () => void;
  /** Select (or deselect with `null`) a ConnectivityNode by clicking a wire. */
  setSelectedNode: (nodeId: NodeId | null) => void;

  // ---- Clipboard actions ----------------------------------------------
  copySelection: () => void;
  cutSelection: () => void;
  pasteClipboard: () => void;

  // ---- Auto-layout actions --------------------------------------------
  /** Drop all explicit placements; let the compiler re-derive everything. */
  autoArrangeAll: () => void;
  /** Drop explicit placements for selected elements only. */
  autoArrangeSelection: () => void;
  /** Bake compiler-computed positions for any unplaced element into d.layout. */
  fillUnplacedAll: () => void;
  /** Same as fillUnplacedAll but scoped to current selection. */
  fillUnplacedSelection: () => void;

  // ---- Document edit shortcuts ----------------------------------------
  moveElements: (deltas: Map<ElementId, [number, number]>) => void;
  deleteSelection: () => void;
  /**
   * Drop every connection (and bus.tap entry) that touches the currently
   * selected ConnectivityNode — effectively "delete this wire". Elements
   * stay; only the connectivity disappears.
   */
  deleteSelectedNode: () => void;
  rotateSelection: (deltaDegrees: 90 | -90 | 180) => void;
  mirrorSelection: () => void;
  addElement: (
    kind: string,
    at: [number, number],
    extra?: Partial<Element>,
  ) => ElementId;
  addConnection: (a: TerminalRef, b: TerminalRef) => void;
  updateElement: (id: ElementId, patch: Partial<Element>) => void;
  updatePlacement: (id: ElementId, patch: Partial<Placement>) => void;
}

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => ({
  diagram: EMPTY_DIAGRAM,
  internal: compile(EMPTY_DIAGRAM),
  fileSession: null,

  activeTool: 'select',
  placeKind: null,
  wireFromTerminal: null,
  placeFromTerminal: null,
  busbarDrawStart: null,
  cursorSvg: null,
  selection: [],
  selectedNode: null,

  past: [],
  future: [],

  clipboard: null,
  clipboardPasteIndex: 0,

  setDiagram: (diagram) =>
    set({
      diagram,
      internal: compile(diagram),
      past: [],
      future: [],
      selection: [],
      selectedNode: null,
      wireFromTerminal: null,
      placeFromTerminal: null,
    }),

  setFileSession: (fileSession) => set({ fileSession }),

  loadDiagramFromFile: (diagram, fileSession) =>
    set({
      diagram,
      internal: compile(diagram),
      fileSession,
      past: [],
      future: [],
      selection: [],
      selectedNode: null,
      wireFromTerminal: null,
      placeFromTerminal: null,
    }),

  dispatch: (mutator) => {
    const { diagram, past } = get();
    const next = mutator(diagram);
    if (next === diagram) return;
    const trimmed = past.length >= HISTORY_LIMIT ? past.slice(1) : past;
    set({
      diagram: next,
      internal: compile(next),
      past: [...trimmed, diagram],
      future: [],
    });
  },

  undo: () => {
    const { past, future, diagram } = get();
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    set({
      diagram: prev,
      internal: compile(prev),
      past: past.slice(0, -1),
      future: [...future, diagram],
      wireFromTerminal: null,
      placeFromTerminal: null,
    });
  },

  redo: () => {
    const { past, future, diagram } = get();
    if (future.length === 0) return;
    const next = future[future.length - 1];
    set({
      diagram: next,
      internal: compile(next),
      past: [...past, diagram],
      future: future.slice(0, -1),
      wireFromTerminal: null,
      placeFromTerminal: null,
    });
  },

  setActiveTool: (tool, opts) =>
    set({
      activeTool: tool,
      placeKind: opts?.placeKind ?? (tool === 'place' ? get().placeKind : null),
      wireFromTerminal: tool === 'wire' ? get().wireFromTerminal : null,
      placeFromTerminal: tool === 'place' ? get().placeFromTerminal : null,
    }),
  setPlaceKind: (kind) => set({ placeKind: kind }),
  setWireFromTerminal: (ref) => set({ wireFromTerminal: ref }),
  setPlaceFromTerminal: (ref) => set({ placeFromTerminal: ref }),
  setBusbarDrawStart: (pt) => set({ busbarDrawStart: pt }),
  setCursorSvg: (pt) => set({ cursorSvg: pt }),

  setSelection: (ids) => set({ selection: dedupe(ids), selectedNode: null }),
  toggleInSelection: (id) => {
    const sel = get().selection;
    set({
      selection: sel.includes(id)
        ? sel.filter((x) => x !== id)
        : [...sel, id],
      selectedNode: null,
    });
  },
  clearSelection: () => set({ selection: [], selectedNode: null }),
  setSelectedNode: (nodeId) =>
    set({ selectedNode: nodeId, selection: nodeId ? [] : get().selection }),

  copySelection: () => {
    const { selection, diagram, internal } = get();
    if (selection.length === 0) return;
    const sel = new Set(selection);

    const elements = diagram.elements
      .filter((e) => sel.has(e.id))
      .map((e) => {
        const cloned = structuredClone(e);
        if (cloned.tap) {
          cloned.tap = cloned.tap.filter((ref) => sel.has(elementOf(ref)));
          if (cloned.tap.length === 0) delete cloned.tap;
        }
        return cloned;
      });

    const placements: Record<ElementId, Placement> = {};
    for (const id of selection) {
      const explicit = diagram.layout?.[id];
      if (explicit) {
        placements[id] = structuredClone(explicit);
        continue;
      }
      const resolved = internal.layout.get(id);
      if (resolved) placements[id] = compactPlacement(resolved);
    }

    const connections = (diagram.connections ?? [])
      .filter((c) =>
        connectionTerminals(c).every((ref) => sel.has(elementOf(ref))),
      )
      .map((c) => structuredClone(c));

    set({
      clipboard: { elements, placements, connections },
      clipboardPasteIndex: 0,
    });
  },

  cutSelection: () => {
    const { selection } = get();
    if (selection.length === 0) return;
    get().copySelection();
    get().deleteSelection();
  },

  pasteClipboard: () => {
    const { clipboard, clipboardPasteIndex, diagram } = get();
    if (!clipboard || clipboard.elements.length === 0) return;
    const step = clipboardPasteIndex + 1;
    const dx = PASTE_OFFSET * step;
    const dy = PASTE_OFFSET * step;

    // Pre-allocate new IDs against a synthetic growing diagram so paste-time
    // collisions across the clipboard batch are avoided.
    const idMap = new Map<ElementId, ElementId>();
    let working = diagram;
    for (const el of clipboard.elements) {
      const newId = newElementId(working, el.kind);
      idMap.set(el.id, newId);
      working = {
        ...working,
        elements: [...working.elements, { id: newId, kind: el.kind }],
      };
    }

    const remapTerminal = (ref: TerminalRef): TerminalRef => {
      const dot = ref.indexOf('.');
      const elId = dot < 0 ? ref : ref.slice(0, dot);
      const remapped = idMap.get(elId);
      if (!remapped) return ref;
      return (dot < 0 ? remapped : `${remapped}${ref.slice(dot)}`) as TerminalRef;
    };

    get().dispatch((d) => {
      const newElements: Element[] = clipboard.elements.map((e) => {
        const cloned = structuredClone(e);
        cloned.id = idMap.get(e.id)!;
        if (cloned.tap) cloned.tap = cloned.tap.map(remapTerminal);
        return cloned;
      });

      const newLayout: Record<ElementId, Placement> = { ...(d.layout ?? {}) };
      for (const [oldId, newId] of idMap) {
        const p = clipboard.placements[oldId];
        if (!p) continue;
        newLayout[newId] = {
          ...p,
          at: [p.at[0] + dx, p.at[1] + dy],
        };
      }

      const newConns: Connection[] = clipboard.connections.map((c) => {
        if (Array.isArray(c)) return c.map(remapTerminal);
        // Drop the named node id — let the compiler mint a fresh one to avoid
        // colliding with the still-extant original.
        const { node: _node, ...rest } = c as NamedConnection;
        void _node;
        return { ...rest, terminals: c.terminals.map(remapTerminal) };
      });

      const mergedConns = [...(d.connections ?? []), ...newConns];
      return {
        ...d,
        elements: [...d.elements, ...newElements],
        connections: mergedConns.length ? mergedConns : undefined,
        layout: newLayout,
      };
    });

    set({
      selection: Array.from(idMap.values()),
      clipboardPasteIndex: step,
    });
  },

  autoArrangeAll: () => {
    get().dispatch((d) => {
      if (!d.layout || Object.keys(d.layout).length === 0) return d;
      const { layout: _layout, ...rest } = d;
      void _layout;
      return rest;
    });
  },

  autoArrangeSelection: () => {
    const { selection } = get();
    if (selection.length === 0) return;
    const drop = new Set(selection);
    get().dispatch((d) => {
      if (!d.layout) return d;
      const next: Record<ElementId, Placement> = {};
      let changed = false;
      for (const [id, p] of Object.entries(d.layout)) {
        if (drop.has(id)) {
          changed = true;
          continue;
        }
        next[id] = p;
      }
      if (!changed) return d;
      return {
        ...d,
        layout: Object.keys(next).length ? next : undefined,
      };
    });
  },

  fillUnplacedAll: () => {
    const internalLayout = get().internal.layout;
    get().dispatch((d) => {
      const explicit = d.layout ?? {};
      const additions: Record<ElementId, Placement> = {};
      for (const el of d.elements) {
        if (explicit[el.id]) continue;
        const resolved = internalLayout.get(el.id);
        if (resolved) additions[el.id] = compactPlacement(resolved);
      }
      if (Object.keys(additions).length === 0) return d;
      return { ...d, layout: { ...explicit, ...additions } };
    });
  },

  fillUnplacedSelection: () => {
    const { selection, internal } = get();
    if (selection.length === 0) return;
    get().dispatch((d) => {
      const explicit = d.layout ?? {};
      const additions: Record<ElementId, Placement> = {};
      for (const id of selection) {
        if (explicit[id]) continue;
        const resolved = internal.layout.get(id);
        if (resolved) additions[id] = compactPlacement(resolved);
      }
      if (Object.keys(additions).length === 0) return d;
      return { ...d, layout: { ...explicit, ...additions } };
    });
  },

  moveElements: (deltas) => {
    if (deltas.size === 0) return;
    const internalLayout = get().internal.layout;
    get().dispatch((d) => {
      const layout = { ...(d.layout ?? {}) };
      for (const [id, delta] of deltas) {
        const cur = layout[id];
        // Auto-placed elements aren't in `d.layout` yet — fall back to the
        // compiler's resolved coords so the move starts from where the user
        // actually sees the element on screen.
        const baseAt: [number, number] = cur?.at ?? internalLayout.get(id)?.at ?? [0, 0];
        layout[id] = {
          ...(cur ?? {}),
          at: [baseAt[0] + delta[0], baseAt[1] + delta[1]],
        };
      }
      return { ...d, layout };
    });
  },

  deleteSelection: () => {
    const { selection } = get();
    if (selection.length === 0) return;
    const ids = new Set(selection);
    get().dispatch((d) => {
      const elements = d.elements.filter((e) => !ids.has(e.id));
      const connections = (d.connections ?? [])
        .map((c) => filterConnection(c, ids))
        .filter((c) => connectionTerminals(c).length >= 2);
      const layout = d.layout
        ? Object.fromEntries(Object.entries(d.layout).filter(([k]) => !ids.has(k)))
        : undefined;
      return {
        ...d,
        elements,
        connections: connections.length ? connections : undefined,
        layout: layout && Object.keys(layout).length ? layout : undefined,
      };
    });
    set({ selection: [] });
  },

  deleteSelectedNode: () => {
    const { selectedNode, internal } = get();
    if (!selectedNode) return;
    const node = internal.nodes.get(selectedNode);
    if (!node) return;
    const memberSet = new Set<string>(node.terminals);

    // Elements that lose a connection here. Auto-placed ones would otherwise
    // jump to a fallback position once the connection that anchored them is
    // gone — bake their current resolved coords into `layout` first so they
    // stay where the user sees them.
    const affectedElementIds = new Set<ElementId>();
    for (const ref of node.terminals) {
      const dot = ref.indexOf('.');
      if (dot > 0) affectedElementIds.add(ref.slice(0, dot));
    }

    get().dispatch((d) => {
      const layout = { ...(d.layout ?? {}) };
      for (const id of affectedElementIds) {
        if (layout[id]) continue;
        const resolved = internal.layout.get(id);
        if (!resolved) continue;
        const placement: Placement = { at: resolved.at };
        if (resolved.rot) placement.rot = resolved.rot;
        if (resolved.mirror) placement.mirror = resolved.mirror;
        if (resolved.span !== undefined) placement.span = resolved.span;
        layout[id] = placement;
      }

      // Drop any connection that touches the node (connections are union-find
      // groups, so by definition every member of the group lives in the same
      // node — `some` is sufficient).
      const connections = (d.connections ?? []).filter((c) => {
        const terms = Array.isArray(c) ? c : c.terminals;
        return !terms.some((t) => memberSet.has(t));
      });
      // Strip bus.tap entries that landed in this node.
      const elements = d.elements.map((el) => {
        if (el.kind !== 'busbar' || !Array.isArray(el.tap)) return el;
        const filtered = el.tap.filter((ref) => !memberSet.has(ref));
        if (filtered.length === el.tap.length) return el;
        const next: Element = { ...el };
        if (filtered.length > 0) next.tap = filtered;
        else delete next.tap;
        return next;
      });
      return {
        ...d,
        elements,
        connections: connections.length ? connections : undefined,
        layout: Object.keys(layout).length ? layout : undefined,
      };
    });
    set({ selectedNode: null });
  },

  rotateSelection: (deltaDegrees) => {
    const { selection, internal } = get();
    if (selection.length === 0) return;
    get().dispatch((d) => {
      const layout = { ...(d.layout ?? {}) };
      for (const id of selection) {
        const cur = layout[id] ?? { at: internal.layout.get(id)?.at ?? [0, 0] };
        const next = (((cur.rot ?? 0) + deltaDegrees) % 360 + 360) % 360;
        layout[id] = { ...cur, rot: next as 0 | 90 | 180 | 270 };
      }
      return { ...d, layout };
    });
  },

  mirrorSelection: () => {
    const { selection, internal } = get();
    if (selection.length === 0) return;
    get().dispatch((d) => {
      const layout = { ...(d.layout ?? {}) };
      for (const id of selection) {
        const cur = layout[id] ?? { at: internal.layout.get(id)?.at ?? [0, 0] };
        layout[id] = { ...cur, mirror: !(cur.mirror ?? false) };
      }
      return { ...d, layout };
    });
  },

  addElement: (kind, at, extra) => {
    const id = newElementId(get().diagram, kind);
    get().dispatch((d) => {
      const newElement: Element = { id, kind, ...(extra ?? {}) };
      return {
        ...d,
        elements: [...d.elements, newElement],
        layout: { ...(d.layout ?? {}), [id]: { at } },
      };
    });
    set({ selection: [id] });
    return id;
  },

  addConnection: (a, b) => {
    if (a === b) return;
    get().dispatch((d) => ({
      ...d,
      connections: [...(d.connections ?? []), [a, b]],
    }));
  },

  updateElement: (id, patch) => {
    get().dispatch((d) => ({
      ...d,
      elements: d.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  },

  updatePlacement: (id, patch) => {
    get().dispatch((d) => {
      const cur = d.layout?.[id] ?? get().internal.layout.get(id);
      const nextPlacement: Placement = {
        at: patch.at ?? cur?.at ?? [0, 0],
        ...(patch.rot !== undefined ? { rot: patch.rot } : cur?.rot ? { rot: cur.rot } : {}),
        ...(patch.mirror !== undefined
          ? { mirror: patch.mirror }
          : cur?.mirror ? { mirror: cur.mirror } : {}),
        ...(patch.span !== undefined
          ? { span: patch.span }
          : cur?.span !== undefined ? { span: cur.span } : {}),
      };
      return {
        ...d,
        layout: { ...(d.layout ?? {}), [id]: nextPlacement },
      };
    });
  },
    }),
    {
      name: 'ole-editor',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Persist only the document and a couple of UI prefs. `internal` is
      // re-derived from `diagram`; `fileSession` holds non-serializable
      // FileSystemFileHandle; selection / cursor / wire-from / undo history
      // are transient by design.
      partialize: (s) => ({
        diagram: s.diagram,
        activeTool: s.activeTool,
        placeKind: s.placeKind,
      }),
      // After rehydration, recompile the internal model so the canvas
      // matches the restored diagram.
      onRehydrateStorage: () => (state) => {
        if (state?.diagram) state.internal = compile(state.diagram);
      },
    },
  ),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function connectionTerminals(c: Connection): TerminalRef[] {
  return Array.isArray(c) ? c : c.terminals;
}

function filterConnection(c: Connection, removed: Set<ElementId>): Connection {
  const keep = (ref: TerminalRef) => !removed.has(elementOf(ref));
  if (Array.isArray(c)) return c.filter(keep);
  return { ...c, terminals: c.terminals.filter(keep) };
}

function elementOf(ref: TerminalRef): ElementId {
  const dot = ref.indexOf('.');
  return dot < 0 ? ref : ref.slice(0, dot);
}

/**
 * `ResolvedPlacement` always carries `rot`/`mirror` (with 0/false defaults).
 * `Placement` (the file format) omits defaults — keep diagram JSON tight and
 * round-trip-stable.
 */
function compactPlacement(rp: ResolvedPlacement): Placement {
  return {
    at: [rp.at[0], rp.at[1]],
    ...(rp.rot ? { rot: rp.rot } : {}),
    ...(rp.mirror ? { mirror: rp.mirror } : {}),
    ...(rp.span !== undefined ? { span: rp.span } : {}),
  };
}
