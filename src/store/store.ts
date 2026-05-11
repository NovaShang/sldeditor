/**
 * Zustand store — the single source of truth for the editor.
 *
 * Mutation rule: the only way to change `diagram` is `dispatch(mutator)`.
 * `dispatch` snapshots the previous diagram onto an undo stack, applies the
 * mutation, recompiles, and clears the redo stack. Targeted helpers
 * (`moveElements`, `addWire`, …) are thin wrappers around `dispatch`.
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
  type BusGeometry,
} from '../compiler';
import type { FileSession } from '../lib/file-io';
import type {
  AnnotationId,
  Bus,
  BusId,
  BusLayout,
  DiagramFile,
  Element,
  ElementId,
  NodeId,
  Placement,
  TextAnnotation,
  Wire,
  WireEnd,
  WireId,
} from '../model';
import {
  newAnnotationId,
  newBusId,
  newElementId,
  wireIdFromEnds,
} from './id-allocator';

const EMPTY_DIAGRAM: DiagramFile = { version: '1', elements: [] };
const HISTORY_LIMIT = 100;
const PASTE_OFFSET = 20;

function defaultTool(): ToolId {
  if (typeof window === 'undefined') return 'select';
  try {
    return window.matchMedia('(pointer: coarse)').matches ? 'pan' : 'select';
  } catch {
    return 'select';
  }
}

/**
 * Self-contained snapshot of a copied selection. Placements are pre-resolved
 * (auto-layout positions baked in) so paste survives later edits to the
 * source diagram. Wires only include those whose endpoints are all within
 * the selection.
 */
export interface ClipboardData {
  elements: Element[];
  buses: Bus[];
  placements: Record<ElementId, Placement>;
  busLayouts: Record<BusId, BusLayout>;
  wires: Wire[];
}

export type ToolId = 'select' | 'pan' | 'wire' | 'place' | 'busbar' | 'text';

export interface EditorState {
  // ---- Document --------------------------------------------------------
  diagram: DiagramFile;
  internal: InternalModel;
  fileSession: FileSession | null;

  // ---- Ephemeral UI state ---------------------------------------------
  activeTool: ToolId;
  placeKind: string | null;
  lastPlaceKind: string | null;
  wireFromTerminal: WireEnd | null;
  placeFromTerminal: WireEnd | null;
  busbarDrawStart: [number, number] | null;
  cursorSvg: [number, number] | null;
  /** Selected devices and/or buses (shared id namespace). */
  selection: ElementId[];
  /** Selected single wire (mutually exclusive with selection/selectedNode). */
  selectedWire: WireId | null;
  /** Selected ConnectivityNode — used for "select the whole electrical
   *  node" operations. Mutually exclusive with the others. */
  selectedNode: NodeId | null;
  selectedAnnotation: AnnotationId | null;
  editingAnnotation: AnnotationId | null;
  editingElement: ElementId | null;

  // ---- History ---------------------------------------------------------
  past: DiagramFile[];
  future: DiagramFile[];

  // ---- Clipboard (ephemeral, not in history) --------------------------
  clipboard: ClipboardData | null;
  clipboardPasteIndex: number;

  // ---- Mutation API ----------------------------------------------------
  setDiagram: (diagram: DiagramFile) => void;
  setFileSession: (session: FileSession | null) => void;
  loadDiagramFromFile: (diagram: DiagramFile, session: FileSession) => void;

  dispatch: (mutator: (d: DiagramFile) => DiagramFile, label?: string) => void;
  undo: () => void;
  redo: () => void;

  // ---- UI actions ------------------------------------------------------
  setActiveTool: (tool: ToolId, opts?: { placeKind?: string | null }) => void;
  setPlaceKind: (kind: string | null) => void;
  setWireFromTerminal: (ref: WireEnd | null) => void;
  setPlaceFromTerminal: (ref: WireEnd | null) => void;
  setBusbarDrawStart: (pt: [number, number] | null) => void;
  setCursorSvg: (pt: [number, number] | null) => void;

  setSelection: (ids: ElementId[]) => void;
  toggleInSelection: (id: ElementId) => void;
  clearSelection: () => void;
  setSelectedWire: (id: WireId | null) => void;
  setSelectedNode: (nodeId: NodeId | null) => void;
  setSelectedAnnotation: (id: AnnotationId | null) => void;
  setEditingAnnotation: (id: AnnotationId | null) => void;
  setEditingElement: (id: ElementId | null) => void;

  // ---- Clipboard actions ----------------------------------------------
  copySelection: () => void;
  cutSelection: () => void;
  pasteClipboard: () => void;

  // ---- Auto-layout actions --------------------------------------------
  autoArrangeAll: () => void;
  autoArrangeSelection: () => void;
  fillUnplacedAll: () => void;
  fillUnplacedSelection: () => void;

  // ---- Document edit shortcuts ----------------------------------------
  moveElements: (deltas: Map<ElementId, [number, number]>) => void;
  deleteSelection: () => void;
  /** Drop a single wire by id. */
  deleteSelectedWire: () => void;
  /** Drop every wire touching the currently selected ConnectivityNode. */
  deleteSelectedNode: () => void;
  rotateSelection: (deltaDegrees: 90 | -90 | 180) => void;
  mirrorSelection: () => void;
  addElement: (
    kind: string,
    at: [number, number],
    extra?: Partial<Element>,
  ) => ElementId;
  addBus: (
    at: [number, number],
    span: number,
    rot?: 0 | 90 | 180 | 270,
  ) => BusId;
  /** Append a wire between two endpoints (idempotent — duplicate is a no-op). */
  addWire: (a: WireEnd, b: WireEnd) => void;
  updateElement: (id: ElementId, patch: Partial<Element>) => void;
  updatePlacement: (id: ElementId, patch: Partial<Placement>) => void;
  updateBus: (id: BusId, patch: Partial<BusLayout>) => void;
  addAnnotation: (at: [number, number], text?: string) => AnnotationId;
  updateAnnotation: (id: AnnotationId, patch: Partial<TextAnnotation>) => void;
  deleteAnnotation: (id: AnnotationId) => void;
}

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => ({
  diagram: EMPTY_DIAGRAM,
  internal: compile(EMPTY_DIAGRAM),
  fileSession: null,

  activeTool: defaultTool(),
  placeKind: null,
  lastPlaceKind: null,
  wireFromTerminal: null,
  placeFromTerminal: null,
  busbarDrawStart: null,
  cursorSvg: null,
  selection: [],
  selectedWire: null,
  selectedNode: null,
  selectedAnnotation: null,
  editingAnnotation: null,
  editingElement: null,

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
      selectedWire: null,
      selectedNode: null,
      selectedAnnotation: null,
      editingAnnotation: null,
      editingElement: null,
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
      selectedWire: null,
      selectedNode: null,
      selectedAnnotation: null,
      editingAnnotation: null,
      editingElement: null,
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

  setActiveTool: (tool, opts) => {
    const cur = get();
    let placeKind: string | null;
    if (opts?.placeKind !== undefined) placeKind = opts.placeKind;
    else if (tool === 'place') placeKind = cur.placeKind ?? cur.lastPlaceKind;
    else placeKind = null;
    set({
      activeTool: tool,
      placeKind,
      lastPlaceKind: placeKind ?? cur.lastPlaceKind,
      wireFromTerminal: tool === 'wire' ? cur.wireFromTerminal : null,
      placeFromTerminal: tool === 'place' ? cur.placeFromTerminal : null,
    });
  },
  setPlaceKind: (kind) =>
    set((s) => ({
      placeKind: kind,
      lastPlaceKind: kind ?? s.lastPlaceKind,
    })),
  setWireFromTerminal: (ref) => set({ wireFromTerminal: ref }),
  setPlaceFromTerminal: (ref) => set({ placeFromTerminal: ref }),
  setBusbarDrawStart: (pt) => set({ busbarDrawStart: pt }),
  setCursorSvg: (pt) => set({ cursorSvg: pt }),

  setSelection: (ids) =>
    set({
      selection: dedupe(ids),
      selectedWire: null,
      selectedNode: null,
      selectedAnnotation: ids.length ? null : get().selectedAnnotation,
    }),
  toggleInSelection: (id) => {
    const sel = get().selection;
    set({
      selection: sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id],
      selectedWire: null,
      selectedNode: null,
      selectedAnnotation: null,
    });
  },
  clearSelection: () =>
    set({
      selection: [],
      selectedWire: null,
      selectedNode: null,
      selectedAnnotation: null,
      editingAnnotation: null,
      editingElement: null,
    }),
  setSelectedWire: (id) =>
    set({
      selectedWire: id,
      selection: id ? [] : get().selection,
      selectedNode: null,
      selectedAnnotation: id ? null : get().selectedAnnotation,
    }),
  setSelectedNode: (nodeId) =>
    set({
      selectedNode: nodeId,
      selection: nodeId ? [] : get().selection,
      selectedWire: null,
      selectedAnnotation: nodeId ? null : get().selectedAnnotation,
    }),
  setSelectedAnnotation: (id) =>
    set({
      selectedAnnotation: id,
      selection: id ? [] : get().selection,
      selectedWire: id ? null : get().selectedWire,
      selectedNode: id ? null : get().selectedNode,
      editingAnnotation: id ? get().editingAnnotation : null,
    }),
  setEditingAnnotation: (id) =>
    set({
      editingAnnotation: id,
      selectedAnnotation: id ?? get().selectedAnnotation,
      editingElement: id ? null : get().editingElement,
    }),
  setEditingElement: (id) =>
    set({
      editingElement: id,
      selection: id ? [id] : get().selection,
      editingAnnotation: id ? null : get().editingAnnotation,
      selectedAnnotation: id ? null : get().selectedAnnotation,
      selectedWire: id ? null : get().selectedWire,
      selectedNode: id ? null : get().selectedNode,
    }),

  copySelection: () => {
    const { selection, diagram, internal } = get();
    if (selection.length === 0) return;
    const sel = new Set(selection);

    const elements = diagram.elements
      .filter((e) => sel.has(e.id))
      .map((e) => structuredClone(e));

    const buses = (diagram.buses ?? [])
      .filter((b) => sel.has(b.id))
      .map((b) => structuredClone(b));

    const placements: Record<ElementId, Placement> = {};
    for (const id of selection) {
      if (sel.has(id) && !internal.buses.has(id)) {
        const explicit = diagram.layout?.[id];
        if (explicit) {
          placements[id] = structuredClone(explicit);
          continue;
        }
        const resolved = internal.layout.get(id);
        if (resolved) placements[id] = compactPlacement(resolved);
      }
    }

    const busLayouts: Record<BusId, BusLayout> = {};
    for (const id of selection) {
      const rb = internal.buses.get(id);
      if (!rb) continue;
      busLayouts[id] = compactBusLayout(rb.geometry);
    }

    const wires = (diagram.wires ?? [])
      .filter((w) =>
        w.ends.every((e) => sel.has(endOwner(e))),
      )
      .map((w) => structuredClone(w));

    set({
      clipboard: { elements, buses, placements, busLayouts, wires },
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
    if (!clipboard) return;
    if (clipboard.elements.length === 0 && clipboard.buses.length === 0) return;
    const step = clipboardPasteIndex + 1;
    const dx = PASTE_OFFSET * step;
    const dy = PASTE_OFFSET * step;

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
    for (const bus of clipboard.buses) {
      const newId = newBusId(working);
      idMap.set(bus.id, newId);
      working = {
        ...working,
        buses: [...(working.buses ?? []), { id: newId }],
      };
    }

    const remapEnd = (end: WireEnd): WireEnd => {
      const dot = end.indexOf('.');
      const head = dot < 0 ? end : end.slice(0, dot);
      const remapped = idMap.get(head);
      if (!remapped) return end;
      return (dot < 0 ? remapped : `${remapped}${end.slice(dot)}`) as WireEnd;
    };

    get().dispatch((d) => {
      const newElements: Element[] = clipboard.elements.map((e) => {
        const cloned = structuredClone(e);
        cloned.id = idMap.get(e.id)!;
        return cloned;
      });

      const newBuses: Bus[] = clipboard.buses.map((b) => {
        const cloned = structuredClone(b);
        cloned.id = idMap.get(b.id)!;
        const layout = clipboard.busLayouts[b.id];
        if (layout) {
          cloned.layout = {
            ...layout,
            at: [layout.at[0] + dx, layout.at[1] + dy],
          };
        }
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

      const newWires: Wire[] = clipboard.wires.map((w) => {
        const ends: [WireEnd, WireEnd] = [
          remapEnd(w.ends[0]),
          remapEnd(w.ends[1]),
        ];
        return { id: wireIdFromEnds(ends[0], ends[1]), ends };
      });

      const wires = mergeWires(d.wires ?? [], newWires);

      return {
        ...d,
        elements: [...d.elements, ...newElements],
        buses: newBuses.length
          ? [...(d.buses ?? []), ...newBuses]
          : d.buses,
        wires: wires.length ? wires : undefined,
        layout: Object.keys(newLayout).length ? newLayout : undefined,
      };
    });

    set({
      selection: Array.from(idMap.values()),
      clipboardPasteIndex: step,
    });
  },

  autoArrangeAll: () => {
    get().dispatch((d) => {
      const hasDeviceLayout = d.layout && Object.keys(d.layout).length > 0;
      const hasBusLayout = (d.buses ?? []).some((b) => b.layout);
      if (!hasDeviceLayout && !hasBusLayout) return d;
      const { layout: _layout, ...rest } = d;
      void _layout;
      const buses = d.buses?.map((b) => {
        const { layout: _bl, ...bRest } = b;
        void _bl;
        return bRest;
      });
      return { ...rest, buses };
    });
  },

  autoArrangeSelection: () => {
    const { selection } = get();
    if (selection.length === 0) return;
    const drop = new Set(selection);
    get().dispatch((d) => {
      let changed = false;
      let layout = d.layout;
      if (layout) {
        const next: Record<ElementId, Placement> = {};
        for (const [id, p] of Object.entries(layout)) {
          if (drop.has(id)) {
            changed = true;
            continue;
          }
          next[id] = p;
        }
        if (changed) layout = Object.keys(next).length ? next : undefined;
      }
      let buses = d.buses;
      if (buses) {
        const next = buses.map((b) => {
          if (drop.has(b.id) && b.layout) {
            changed = true;
            const { layout: _bl, ...rest } = b;
            void _bl;
            return rest;
          }
          return b;
        });
        if (changed) buses = next;
      }
      if (!changed) return d;
      return { ...d, layout, buses };
    });
  },

  fillUnplacedAll: () => {
    const internal = get().internal;
    get().dispatch((d) => {
      const explicit = d.layout ?? {};
      const additions: Record<ElementId, Placement> = {};
      for (const el of d.elements) {
        if (explicit[el.id]) continue;
        const resolved = internal.layout.get(el.id);
        if (resolved) additions[el.id] = compactPlacement(resolved);
      }
      const busesNeedLayout: { idx: number; bus: Bus }[] = [];
      (d.buses ?? []).forEach((b, idx) => {
        if (b.layout) return;
        if (internal.buses.has(b.id)) busesNeedLayout.push({ idx, bus: b });
      });
      if (
        Object.keys(additions).length === 0 &&
        busesNeedLayout.length === 0
      ) {
        return d;
      }
      let buses = d.buses;
      if (busesNeedLayout.length > 0 && buses) {
        buses = buses.map((b) => {
          const rb = internal.buses.get(b.id);
          if (!b.layout && rb) {
            return { ...b, layout: compactBusLayout(rb.geometry) };
          }
          return b;
        });
      }
      return {
        ...d,
        layout: { ...explicit, ...additions },
        buses,
      };
    });
  },

  fillUnplacedSelection: () => {
    const { selection, internal } = get();
    if (selection.length === 0) return;
    get().dispatch((d) => {
      const explicit = d.layout ?? {};
      const additions: Record<ElementId, Placement> = {};
      const busesPatch = new Map<BusId, BusLayout>();
      for (const id of selection) {
        if (internal.buses.has(id)) {
          const rb = internal.buses.get(id)!;
          if (!d.buses?.find((b) => b.id === id && b.layout)) {
            busesPatch.set(id, compactBusLayout(rb.geometry));
          }
        } else {
          if (explicit[id]) continue;
          const resolved = internal.layout.get(id);
          if (resolved) additions[id] = compactPlacement(resolved);
        }
      }
      if (Object.keys(additions).length === 0 && busesPatch.size === 0) {
        return d;
      }
      let buses = d.buses;
      if (busesPatch.size > 0 && buses) {
        buses = buses.map((b) =>
          busesPatch.has(b.id) ? { ...b, layout: busesPatch.get(b.id)! } : b,
        );
      }
      return {
        ...d,
        layout: { ...explicit, ...additions },
        buses,
      };
    });
  },

  moveElements: (deltas) => {
    if (deltas.size === 0) return;
    const internal = get().internal;
    get().dispatch((d) => {
      const layout = { ...(d.layout ?? {}) };
      const busPatches = new Map<BusId, [number, number]>();
      for (const [id, delta] of deltas) {
        if (internal.buses.has(id)) {
          busPatches.set(id, delta);
          continue;
        }
        const resolved = internal.layout.get(id);
        const base: Placement =
          layout[id] ?? (resolved ? compactPlacement(resolved) : { at: [0, 0] });
        layout[id] = {
          ...base,
          at: [base.at[0] + delta[0], base.at[1] + delta[1]],
        };
      }
      let buses = d.buses;
      if (busPatches.size > 0) {
        buses = (d.buses ?? []).map((b) => {
          const delta = busPatches.get(b.id);
          if (!delta) return b;
          const cur =
            b.layout ?? compactBusLayout(internal.buses.get(b.id)!.geometry);
          return {
            ...b,
            layout: {
              ...cur,
              at: [cur.at[0] + delta[0], cur.at[1] + delta[1]],
            },
          };
        });
      }
      return { ...d, layout, buses };
    });
  },

  deleteSelection: () => {
    const { selection } = get();
    if (selection.length === 0) return;
    const ids = new Set(selection);
    get().dispatch((d) => {
      const elements = d.elements.filter((e) => !ids.has(e.id));
      const buses = (d.buses ?? []).filter((b) => !ids.has(b.id));
      const wires = (d.wires ?? []).filter(
        (w) => !ids.has(endOwner(w.ends[0])) && !ids.has(endOwner(w.ends[1])),
      );
      const layout = d.layout
        ? Object.fromEntries(
            Object.entries(d.layout).filter(([k]) => !ids.has(k)),
          )
        : undefined;
      return {
        ...d,
        elements,
        buses: buses.length ? buses : undefined,
        wires: wires.length ? wires : undefined,
        layout: layout && Object.keys(layout).length ? layout : undefined,
      };
    });
    set({ selection: [] });
  },

  deleteSelectedWire: () => {
    const { selectedWire } = get();
    if (!selectedWire) return;
    get().dispatch((d) => {
      const wires = (d.wires ?? []).filter((w) => w.id !== selectedWire);
      if (wires.length === (d.wires ?? []).length) return d;
      return {
        ...d,
        wires: wires.length ? wires : undefined,
      };
    });
    set({ selectedWire: null });
  },

  deleteSelectedNode: () => {
    const { selectedNode, internal } = get();
    if (!selectedNode) return;
    const node = internal.nodes.get(selectedNode);
    if (!node) return;
    const memberSet = new Set<WireEnd>(node.terminals);

    const affectedElementIds = new Set<ElementId>();
    for (const end of node.terminals) {
      const dot = end.indexOf('.');
      if (dot > 0) affectedElementIds.add(end.slice(0, dot));
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
        layout[id] = placement;
      }

      const wires = (d.wires ?? []).filter(
        (w) => !memberSet.has(w.ends[0]) && !memberSet.has(w.ends[1]),
      );
      return {
        ...d,
        wires: wires.length ? wires : undefined,
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
      const busPatches = new Map<BusId, 0 | 90 | 180 | 270>();
      for (const id of selection) {
        if (internal.buses.has(id)) {
          const rb = internal.buses.get(id)!;
          const cur =
            d.buses?.find((b) => b.id === id)?.layout?.rot ?? rb.geometry.rot;
          const next = (((cur ?? 0) + deltaDegrees) % 360 + 360) % 360;
          busPatches.set(id, next as 0 | 90 | 180 | 270);
          continue;
        }
        const cur = layout[id] ?? { at: internal.layout.get(id)?.at ?? [0, 0] };
        const next = (((cur.rot ?? 0) + deltaDegrees) % 360 + 360) % 360;
        layout[id] = { ...cur, rot: next as 0 | 90 | 180 | 270 };
      }
      let buses = d.buses;
      if (busPatches.size > 0) {
        buses = (d.buses ?? []).map((b) => {
          if (!busPatches.has(b.id)) return b;
          const cur =
            b.layout ?? compactBusLayout(internal.buses.get(b.id)!.geometry);
          return { ...b, layout: { ...cur, rot: busPatches.get(b.id)! } };
        });
      }
      return { ...d, layout, buses };
    });
  },

  mirrorSelection: () => {
    const { selection, internal } = get();
    if (selection.length === 0) return;
    get().dispatch((d) => {
      const layout = { ...(d.layout ?? {}) };
      for (const id of selection) {
        if (internal.buses.has(id)) continue; // buses don't mirror
        const cur = layout[id] ?? { at: internal.layout.get(id)?.at ?? [0, 0] };
        layout[id] = { ...cur, mirror: !(cur.mirror ?? false) };
      }
      return { ...d, layout };
    });
  },

  addElement: (kind, at, extra) => {
    if (kind === 'busbar') {
      return get().addBus(at, 320);
    }
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

  addBus: (at, span, rot) => {
    const id = newBusId(get().diagram);
    get().dispatch((d) => {
      const bus: Bus = {
        id,
        layout: rot !== undefined ? { at, span, rot } : { at, span },
      };
      return {
        ...d,
        buses: [...(d.buses ?? []), bus],
      };
    });
    set({ selection: [id] });
    return id;
  },

  addWire: (a, b) => {
    if (a === b) return;
    const id = wireIdFromEnds(a, b);
    get().dispatch((d) => {
      const existing = d.wires ?? [];
      if (existing.some((w) => w.id === id)) return d;
      return {
        ...d,
        wires: [...existing, { id, ends: [a, b] }],
      };
    });
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
      };
      return {
        ...d,
        layout: { ...(d.layout ?? {}), [id]: nextPlacement },
      };
    });
  },

  updateBus: (id, patch) => {
    get().dispatch((d) => {
      const buses = (d.buses ?? []).map((b) => {
        if (b.id !== id) return b;
        const internal = get().internal;
        const cur =
          b.layout ?? (internal.buses.has(id)
            ? compactBusLayout(internal.buses.get(id)!.geometry)
            : { at: [0, 0] as [number, number], span: 320 });
        const next: BusLayout = {
          at: patch.at ?? cur.at,
          span: patch.span ?? cur.span,
          ...(patch.rot !== undefined
            ? { rot: patch.rot }
            : cur.rot ? { rot: cur.rot } : {}),
        };
        return { ...b, layout: next };
      });
      return { ...d, buses };
    });
  },

  addAnnotation: (at, text = '') => {
    const id = newAnnotationId(get().diagram);
    get().dispatch((d) => {
      const ann: TextAnnotation = { id, at, text };
      return { ...d, annotations: [...(d.annotations ?? []), ann] };
    });
    return id;
  },
  updateAnnotation: (id, patch) => {
    get().dispatch((d) => {
      const list = d.annotations ?? [];
      let changed = false;
      const next = list.map((a) => {
        if (a.id !== id) return a;
        changed = true;
        return { ...a, ...patch, id: a.id };
      });
      if (!changed) return d;
      return { ...d, annotations: next };
    });
  },
  deleteAnnotation: (id) => {
    get().dispatch((d) => {
      const list = d.annotations ?? [];
      const next = list.filter((a) => a.id !== id);
      if (next.length === list.length) return d;
      return {
        ...d,
        annotations: next.length ? next : undefined,
      };
    });
    if (get().selectedAnnotation === id) {
      set({ selectedAnnotation: null, editingAnnotation: null });
    }
  },
    }),
    {
      name: 'ole-editor',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        diagram: s.diagram,
        activeTool: s.activeTool,
        placeKind: s.placeKind,
        lastPlaceKind: s.lastPlaceKind,
      }),
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

function endOwner(end: WireEnd): ElementId {
  const dot = end.indexOf('.');
  return dot < 0 ? end : end.slice(0, dot);
}

/** Concatenate two wire lists, dropping duplicates (by content-hash id). */
function mergeWires(a: Wire[], b: Wire[]): Wire[] {
  const seen = new Set<WireId>(a.map((w) => w.id));
  const out = a.slice();
  for (const w of b) {
    if (seen.has(w.id)) continue;
    seen.add(w.id);
    out.push(w);
  }
  return out;
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
  };
}

function compactBusLayout(g: BusGeometry): BusLayout {
  return {
    at: [g.at[0], g.at[1]],
    span: g.span,
    ...(g.rot ? { rot: g.rot } : {}),
  };
}
