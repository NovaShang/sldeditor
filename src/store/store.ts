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

import { create, type StateCreator } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  compile,
  type InternalModel,
  type ResolvedPlacement,
  type BusGeometry,
} from '../compiler';
import type { FileSession } from '../lib/file-io';
import { annotationBBox, type AnnotationDraft } from '../lib/annotation-geom';
import type {
  Annotation,
  AnnotationId,
  AnnotationPatch,
  Bus,
  BusId,
  BusLayout,
  DiagramColor,
  DiagramFile,
  DiagramMeta,
  Element,
  ElementId,
  EllipseAnnotation,
  Junction,
  JunctionId,
  LineAnnotation,
  NodeId,
  Placement,
  RectAnnotation,
  TableAnnotation,
  TextAnnotation,
  Wire,
  WireEnd,
  WireId,
} from '../model';
import {
  newAnnotationId,
  newBusId,
  newElementId,
  newJunctionId,
  wireIdFromEnds,
} from './id-allocator';
import { normalizePath } from '../model/wire-path';
import { clampSymbolScale } from '../model';
import {
  SHEET_GAP_MM,
  UNITS_PER_MM,
  clampSheetScale,
  fitScale,
  labelFontForPrint,
  migrateLegacyFrame,
  nextSheetId,
  sheetAroundBox,
  sheetRect,
  type PaperId,
  type Sheet,
  type SheetOrientation,
  type TitleBlockShared,
} from '../model/sheet';
import { computeContentBbox } from '../lib/export-image';
import { targetBox } from '../health/present';
import { sheetContentIds } from '../canvas/sheet-hit';
import { libraryById } from '../element-library';
import { familyOf } from '../lib/kind-families';
import { endOwner, translateManualWirePaths } from './group-move';
import { pruneOrphanedJunctions } from './prune-junctions';
import { removeBindingsForTargets } from '../runtime/bindings';

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
  junctions: Junction[];
  placements: Record<ElementId, Placement>;
  busLayouts: Record<BusId, BusLayout>;
  wires: Wire[];
  /** Copied free annotations (from the `selectedAnnotations` channel). */
  annotations: Annotation[];
}

export type ToolId =
  | 'select'
  | 'pan'
  | 'wire'
  | 'place'
  | 'busbar'
  | 'junction'
  | 'text'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'table';

/** Annotation body accepted by `insertAnnotation` (id minted by the store). */
export type NewAnnotation =
  | Omit<TextAnnotation, 'id'>
  | Omit<RectAnnotation, 'id'>
  | Omit<EllipseAnnotation, 'id'>
  | Omit<LineAnnotation, 'id'>
  | Omit<TableAnnotation, 'id'>;

/**
 * How one end of a freshly-drawn wire should resolve at commit time. The wire
 * tool can land on an existing connectable, on empty space (→ mint a junction),
 * or on an existing wire body (→ split it and mint a junction at the tap).
 */
export type WireEndSpec =
  | { end: WireEnd }
  | { junctionAt: [number, number] }
  | { onWire: WireId; at: [number, number] };

/** Live state of an in-progress wire drag (origin). */
export interface WireDragFrom {
  spec: WireEndSpec;
  /** Anchor point for the preview line. */
  world: [number, number];
  /** Existing-end ref when the origin is a pin/bus/junction, else null. */
  ref: WireEnd | null;
}

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
  /** Canonical in-progress wire-drag origin (supports free-space starts). */
  wireDragFrom: WireDragFrom | null;
  placeFromTerminal: WireEnd | null;
  busbarDrawStart: [number, number] | null;
  cursorSvg: [number, number] | null;
  /** Selected devices, buses and/or junctions (shared id namespace). */
  selection: ElementId[];
  /** Selected single wire (mutually exclusive with selection/selectedNode). */
  selectedWire: WireId | null;
  /** Selected ConnectivityNode — used for "select the whole electrical
   *  node" operations. Mutually exclusive with the others. */
  selectedNode: NodeId | null;
  /**
   * Selected free annotations. A *separate* channel from `selection` rather
   * than extra members in it: annotation ids live in their own namespace and
   * every consumer of `selection` (layout, rotate/mirror, wire endpoints,
   * auto-arrange) assumes element/bus/junction ids. The two coexist — a
   * marquee can produce a mixed selection and drag it as one — while wire and
   * node selection stay mutually exclusive with both.
   *
   * Annotation-only affordances (resize handles, the annotation property
   * panel, click-again-to-edit) are single-target by nature and key off
   * `soleSelectedAnnotation` rather than this list.
   */
  selectedAnnotations: AnnotationId[];
  /** The selected drawing sheet (its own channel: selecting a sheet clears
   *  the others and vice versa). */
  selectedSheet: string | null;
  editingAnnotation: AnnotationId | null;
  /** Table cell being edited (`[row, col]`), only with `editingAnnotation`. */
  editingCell: [number, number] | null;
  /** In-progress rect/line/table drag published by the drawing tools. */
  annotationDraft: AnnotationDraft | null;
  /**
   * Ephemeral geometry override rendered *instead of* the model annotation
   * with the same id — resize/vertex handles publish live previews here and
   * commit a single `updateAnnotation` on release, so a whole handle drag is
   * one undo entry (dispatching per pointermove would flood history).
   */
  annotationPreview: Annotation | null;
  editingElement: ElementId | null;
  /** View-only mode: disables every editing interaction and hides the editing
   *  chrome while keeping pan/zoom. Set via the OneLineEditor `readOnly` prop.
   *  Ephemeral — never persisted (see the storage wrapper below). */
  readOnly: boolean;

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
  setWireDragFrom: (from: WireDragFrom | null) => void;
  setPlaceFromTerminal: (ref: WireEnd | null) => void;
  setBusbarDrawStart: (pt: [number, number] | null) => void;
  setCursorSvg: (pt: [number, number] | null) => void;

  /**
   * Replace the element/bus/junction selection. `annIds` replaces the
   * annotation selection in the same update (the marquee commits both at
   * once); omitted, annotations are cleared unless `ids` is empty.
   */
  setSelection: (ids: ElementId[], annIds?: AnnotationId[]) => void;
  toggleInSelection: (id: ElementId) => void;
  clearSelection: () => void;
  setSelectedWire: (id: WireId | null) => void;
  setSelectedNode: (nodeId: NodeId | null) => void;
  /** Select exactly one annotation (replacing both selection channels). */
  setSelectedAnnotation: (id: AnnotationId | null) => void;
  /** Shift-click equivalent for annotations: add/remove without replacing. */
  toggleAnnotationInSelection: (id: AnnotationId) => void;
  setEditingAnnotation: (id: AnnotationId | null) => void;
  setEditingCell: (cell: [number, number] | null) => void;
  setAnnotationDraft: (draft: AnnotationDraft | null) => void;
  setAnnotationPreview: (preview: Annotation | null) => void;
  setEditingElement: (id: ElementId | null) => void;
  setReadOnly: (readOnly: boolean) => void;

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
  /**
   * Translate elements / buses / junctions (and optionally annotations) in a
   * single dispatch, so one drag gesture is one undo entry. Manual wire
   * routes whose *both* endpoints are in `deltas` travel with the move (see
   * `translateManualWirePaths`).
   */
  moveElements: (
    deltas: Map<ElementId, [number, number]>,
    annotationDeltas?: Map<AnnotationId, [number, number]>,
  ) => void;
  /** Delete everything selected — elements, buses, junctions *and*
   *  annotations — in one undo entry. */
  deleteSelection: () => void;
  /** Drop a single wire by id. */
  deleteSelectedWire: () => void;
  /** Drop every wire touching the currently selected ConnectivityNode. */
  deleteSelectedNode: () => void;
  rotateSelection: (deltaDegrees: 90 | -90 | 180) => void;
  mirrorSelection: () => void;
  /**
   * Recolour everything selected — elements, buses, the selected wire *and*
   * annotations — in one undo entry.
   *
   * Colour has been on the model since 0.21 and the agent could already set
   * it, but by hand it was one object at a time. The only user feedback of the
   * 2026-08-22→28 week was "I would like to multi select and change colour.
   * Changing item colour, by colour is hectic." Junctions are excluded because
   * they carry no `color` — they render as connection dots in theme ink.
   *
   * `'default'` DELETES the field rather than storing the word: a diagram with
   * no colours has to keep serialising exactly as it did before colours
   * existed, which the SVG/DXF exporters depend on.
   */
  setSelectionColor: (color: DiagramColor) => void;
  /**
   * Put the structural labels of every selected element back on the anchor
   * their library entry declares — the undo for a label the user dragged
   * somewhere they now regret. Dispatches nothing when no selected element
   * carries an offset, so it never contributes an empty undo step.
   */
  resetSelectionLabelOffset: () => void;
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
  /** Drop a free-standing junction (point connection node) at `at`. */
  addJunction: (at: [number, number]) => JunctionId;
  updateJunction: (id: JunctionId, patch: Partial<Junction>) => void;
  /**
   * Fold a junction into another connection point: every wire that ended at
   * the junction now ends at `target` (re-routed), and the junction goes. A
   * wire that would join `target` to itself, or duplicate an existing wire,
   * is dropped. One undo entry. This is what dropping a free wire end onto
   * a pin, a bus or another joint means — before it, the end only moved and
   * sat on the pin looking connected while it was not.
   */
  mergeJunctionInto: (id: JunctionId, target: WireEnd) => void;
  setSelectedSheet: (id: string | null) => void;
  /**
   * Add a sheet. The first one frames the existing drawing (enlarging the
   * frame when the drawing is bigger than the paper); later ones go to the
   * right of the last sheet, at its scale. Returns the new id and selects it.
   */
  addSheet: (paper: PaperId, orientation: SheetOrientation) => string;
  updateSheet: (id: string, patch: Partial<Omit<Sheet, 'id'>>) => void;
  /** Delete a sheet. Its contents stay on the canvas. */
  removeSheet: (id: string) => void;
  /** Move a sheet one place earlier (-1) or later (+1) in page order. */
  reorderSheet: (id: string, dir: -1 | 1) => void;
  /** Move a sheet and everything drawn inside it, one undo entry. */
  moveSheet: (id: string, dx: number, dy: number) => void;
  /** Enlarge the frame (nice scale steps) so everything inside or overlapping
   *  it fits the drawing area; keeps the content where it is. */
  fitSheet: (id: string) => void;
  /** Set the document label size so labels print at the target size on
   *  this sheet. */
  enlargeLabelsForPrint: (id: string) => void;
  updateTitleBlock: (patch: Partial<TitleBlockShared>) => void;
  /** Append a wire between two endpoints (idempotent — duplicate is a no-op). */
  addWire: (a: WireEnd, b: WireEnd) => void;
  /**
   * Commit a freshly-drawn wire. Each end may be an existing connectable, a
   * new junction (free-space drop), or a tap that splits an existing wire —
   * all minted/split in one dispatch so the gesture is a single undo step.
   */
  connectWire: (from: WireEndSpec, to: WireEndSpec) => void;
  /** Replace a wire's manual route. `null` clears it → back to auto-route. */
  updateWirePath: (id: WireId, path: [number, number][] | null) => void;
  /** Clear a wire's manual route (alias for `updateWirePath(id, null)`). */
  resetWirePath: (id: WireId) => void;
  /**
   * Patch a wire's decoration fields (label, colour). Route edits go through
   * `updateWirePath`; endpoints are immutable (delete + redraw instead).
   */
  updateWire: (id: WireId, patch: Partial<Pick<Wire, 'label' | 'color'>>) => void;
  updateElement: (id: ElementId, patch: Partial<Element>) => void;
  /**
   * Swap an element to another kind of the same family (see
   * `lib/kind-families.ts`) in place: id, name, colour, placement and wires
   * stay. State is dropped (its fields belong to the old kind) and params the
   * new kind does not declare are dropped with it. One undo entry.
   */
  changeKind: (id: ElementId, kind: string) => void;
  /**
   * Mark a health-check issue intentional (or undo that). Stored in
   * `meta.healthDismissed` so it travels with the document; one undo entry.
   */
  setHealthDismissed: (issueId: string, dismissed: boolean) => void;
  updatePlacement: (id: ElementId, patch: Partial<Placement>) => void;
  /**
   * Live placement change during a drag (the symbol-size grips): the canvas,
   * wires and labels follow every move, but nothing reaches the undo stack
   * until `endGesture(true)` — so one drag is one undo entry. The document as
   * it was when the first preview landed is kept and restored on cancel.
   */
  previewPlacement: (id: ElementId, patch: Partial<Placement>) => void;
  /** Close a preview gesture: commit as ONE undo entry, or roll it back. */
  endGesture: (commit: boolean) => void;
  /** Document before the in-flight preview gesture, or null when idle. */
  gestureBase: DiagramFile | null;
  updateBus: (id: BusId, patch: Partial<BusLayout>) => void;
  addAnnotation: (at: [number, number], text?: string) => AnnotationId;
  /** Append a fully-specified annotation (rect / line / table / text). */
  insertAnnotation: (ann: NewAnnotation) => AnnotationId;
  updateAnnotation: (id: AnnotationId, patch: AnnotationPatch) => void;
  deleteAnnotation: (id: AnnotationId) => void;
  /**
   * Drop a symbol this document defines.
   *
   * Refuses while anything is still placed, and says how many — removing the
   * definition out from under live elements would turn them into unresolvable
   * kinds, which is the one failure mode that makes a file unopenable rather
   * than merely wrong. Returns the blocking count, or 0 on success.
   */
  removeCustomKind: (kindId: string) => number;
}

/**
 * The state initialiser, shared by the singleton editor store below and by
 * `createEditorStore()`. Kept as one function so a private instance (the
 * read-only viewer) behaves byte-for-byte like the editor's — same compile,
 * same selection semantics — without a second implementation to drift.
 */

/**
 * Translate devices, buses, junctions and annotations by per-id deltas (the
 * body of `moveElements`, shared with `moveSheet` so a sheet and its contents
 * move in one undo entry).
 */
function applyMoves(
  d: DiagramFile,
  internal: InternalModel,
  deltas: Map<ElementId, [number, number]>,
  annotationDeltas?: Map<AnnotationId, [number, number]>,
): DiagramFile {
  const layout = { ...(d.layout ?? {}) };
  const busPatches = new Map<BusId, [number, number]>();
  const junctionPatches = new Map<JunctionId, [number, number]>();
  for (const [id, delta] of deltas) {
    if (internal.buses.has(id)) {
      busPatches.set(id, delta);
      continue;
    }
    if (internal.junctions.has(id)) {
      junctionPatches.set(id, delta);
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
  let junctions = d.junctions;
  if (junctionPatches.size > 0) {
    junctions = (d.junctions ?? []).map((j) => {
      const delta = junctionPatches.get(j.id);
      if (!delta) return j;
      const at = j.layout?.at ?? internal.junctions.get(j.id)?.world ?? [0, 0];
      return { ...j, layout: { at: [at[0] + delta[0], at[1] + delta[1]] } };
    });
  }
  let annotations = d.annotations;
  if (annotationDeltas?.size && annotations) {
    annotations = annotations.map((a) => {
      const delta = annotationDeltas.get(a.id);
      if (!delta) return a;
      return {
        ...a,
        at: [a.at[0] + delta[0], a.at[1] + delta[1]] as [number, number],
      };
    });
  }
  // Manual wire routes follow the move only when the whole conductor is
  // inside it — see `translateManualWirePaths` for why this can't live in
  // the compiler.
  const wires = translateManualWirePaths(d.wires, deltas);
  return { ...d, layout, buses, junctions, wires, annotations };
}


/** World bounds of everything drawn (devices, labels, wires, annotations),
 *  sheets excluded; null for an empty drawing. */
function drawingBox(
  d: DiagramFile,
  internal: InternalModel,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (internal.elements.size === 0 && internal.buses.size === 0 && !(d.annotations?.length)) return null;
  const b = computeContentBbox(internal, {
    annotations: d.annotations,
    labelMode: d.meta?.labelMode,
    labelFontSize: d.meta?.labelFontSize,
  });
  return Number.isFinite(b.minX) && b.maxX > b.minX ? b : null;
}

/** Bounds of what a sheet holds (inside or overlapping it), for fitting. */
function sheetContentBox(
  d: DiagramFile,
  internal: InternalModel,
  sheet: Sheet,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const r = sheetRect(sheet);
  const overlaps = (b: { minX: number; minY: number; maxX: number; maxY: number }) =>
    b.maxX >= r.x && b.minX <= r.x + r.w && b.maxY >= r.y && b.minY <= r.y + r.h;
  let box: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  const add = (b: { minX: number; minY: number; maxX: number; maxY: number }) => {
    box = box
      ? { minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY), maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY) }
      : { ...b };
  };
  for (const id of [...internal.elements.keys(), ...internal.buses.keys(), ...internal.junctions.keys()]) {
    const b = targetBox(internal, id);
    if (b && overlaps(b)) add(b);
  }
  // Full annotation extent (a line's points, a table's cells, text width),
  // the same measure the inspector's overflow warning uses — otherwise Fit
  // could leave that warning showing.
  for (const a of d.annotations ?? []) {
    const b = annotationBBox(a);
    if (overlaps(b)) add(b);
  }
  return box;
}

const createEditorState: StateCreator<EditorState> = (set, get) => ({
  diagram: EMPTY_DIAGRAM,
  internal: compile(EMPTY_DIAGRAM),
  fileSession: null,

  activeTool: defaultTool(),
  placeKind: null,
  lastPlaceKind: null,
  wireFromTerminal: null,
  wireDragFrom: null,
  placeFromTerminal: null,
  busbarDrawStart: null,
  cursorSvg: null,
  selection: [],
  selectedSheet: null,
  selectedWire: null,
  selectedNode: null,
  selectedAnnotations: [],
  editingAnnotation: null,
  editingCell: null,
  annotationDraft: null,
  annotationPreview: null,
  editingElement: null,
  readOnly: false,
  gestureBase: null,

  past: [],
  future: [],

  clipboard: null,
  clipboardPasteIndex: 0,

  setDiagram: (input) => {
    // The old annotation frame becomes sheet 1 the first time it is opened.
    const diagram = migrateLegacyFrame(input);
    set({
      diagram,
      internal: compile(diagram),
      selectedSheet: null,
      past: [],
      future: [],
      selection: [],
      selectedWire: null,
      selectedNode: null,
      selectedAnnotations: [],
      editingAnnotation: null,
      editingCell: null,
      annotationDraft: null,
      annotationPreview: null,
      gestureBase: null,
      editingElement: null,
      wireFromTerminal: null,
      wireDragFrom: null,
      placeFromTerminal: null,
    });
  },

  setFileSession: (fileSession) => set({ fileSession }),

  setReadOnly: (readOnly) => set({ readOnly }),

  loadDiagramFromFile: (input, fileSession) => {
    const diagram = migrateLegacyFrame(input);
    set({
      diagram,
      internal: compile(diagram),
      selectedSheet: null,
      fileSession,
      past: [],
      future: [],
      selection: [],
      selectedWire: null,
      selectedNode: null,
      selectedAnnotations: [],
      editingAnnotation: null,
      editingCell: null,
      annotationDraft: null,
      annotationPreview: null,
      gestureBase: null,
      editingElement: null,
      wireFromTerminal: null,
      wireDragFrom: null,
      placeFromTerminal: null,
    });
  },

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
      // A committed document change invalidates any in-flight geometry
      // preview: the ephemeral `annotationPreview` shadows the model
      // annotation of the same id in the renderer, so leaving a stale one set
      // would hide this very change until the next preview rebuild (e.g. a
      // resize). Clearing here keeps the canvas honest after every edit —
      // including property-panel edits like table row/column count.
      annotationPreview: null,
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
      wireDragFrom: null,
      placeFromTerminal: null,
      annotationPreview: null,
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
      wireDragFrom: null,
      placeFromTerminal: null,
      annotationPreview: null,
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
      wireDragFrom: tool === 'wire' ? cur.wireDragFrom : null,
      placeFromTerminal: tool === 'place' ? cur.placeFromTerminal : null,
      annotationDraft: null,
    });
  },
  setPlaceKind: (kind) =>
    set((s) => ({
      placeKind: kind,
      lastPlaceKind: kind ?? s.lastPlaceKind,
    })),
  setWireFromTerminal: (ref) => set({ wireFromTerminal: ref }),
  setWireDragFrom: (from) => set({ wireDragFrom: from }),
  setPlaceFromTerminal: (ref) => set({ placeFromTerminal: ref }),
  setBusbarDrawStart: (pt) => set({ busbarDrawStart: pt }),
  setCursorSvg: (pt) => set({ cursorSvg: pt }),

  setSelection: (ids, annIds) =>
    set({
      selectedSheet: null,
      selection: dedupe(ids),
      selectedWire: null,
      selectedNode: null,
      selectedAnnotations: annIds
        ? dedupe(annIds)
        : ids.length
          ? []
          : get().selectedAnnotations,
    }),
  toggleInSelection: (id) => {
    const sel = get().selection;
    set({
      selection: sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id],
      selectedWire: null,
      selectedNode: null,
      selectedSheet: null,
      // Shift-click *extends* — it must not silently drop annotations the
      // user picked up with the marquee.
    });
  },
  clearSelection: () =>
    set({
      selectedSheet: null,
      selection: [],
      selectedWire: null,
      selectedNode: null,
      selectedAnnotations: [],
      editingAnnotation: null,
      editingCell: null,
      editingElement: null,
    }),
  setSelectedWire: (id) =>
    set({
      selectedSheet: null,
      selectedWire: id,
      selection: id ? [] : get().selection,
      selectedNode: null,
      selectedAnnotations: id ? [] : get().selectedAnnotations,
    }),
  setSelectedNode: (nodeId) =>
    set({
      selectedSheet: null,
      selectedNode: nodeId,
      selection: nodeId ? [] : get().selection,
      selectedWire: null,
      selectedAnnotations: nodeId ? [] : get().selectedAnnotations,
    }),
  setSelectedAnnotation: (id) =>
    set({
      selectedSheet: null,
      selectedAnnotations: id ? [id] : [],
      selection: id ? [] : get().selection,
      selectedWire: id ? null : get().selectedWire,
      selectedNode: id ? null : get().selectedNode,
      editingAnnotation: id ? get().editingAnnotation : null,
      editingCell: id ? get().editingCell : null,
    }),
  toggleAnnotationInSelection: (id) => {
    const sel = get().selectedAnnotations;
    set({
      selectedSheet: null,
      selectedAnnotations: sel.includes(id)
        ? sel.filter((x) => x !== id)
        : [...sel, id],
      selectedWire: null,
      selectedNode: null,
      editingAnnotation: null,
      editingCell: null,
    });
  },
  setEditingAnnotation: (id) =>
    set({
      editingAnnotation: id,
      selectedAnnotations: id ? [id] : get().selectedAnnotations,
      editingElement: id ? null : get().editingElement,
      // Cell targeting is per-edit-session; the caller re-sets it when
      // entering a table cell right after this.
      editingCell: null,
    }),
  setEditingCell: (editingCell) => set({ editingCell }),
  setAnnotationDraft: (annotationDraft) => set({ annotationDraft }),
  setAnnotationPreview: (annotationPreview) => set({ annotationPreview }),
  setEditingElement: (id) =>
    set({
      editingElement: id,
      selection: id ? [id] : get().selection,
      editingAnnotation: id ? null : get().editingAnnotation,
      selectedAnnotations: id ? [] : get().selectedAnnotations,
      selectedWire: id ? null : get().selectedWire,
      selectedNode: id ? null : get().selectedNode,
    }),

  copySelection: () => {
    const { selection, selectedAnnotations, diagram, internal } = get();
    if (selection.length === 0 && selectedAnnotations.length === 0) return;
    const annSet = new Set(selectedAnnotations);
    const copiedAnnotations = (diagram.annotations ?? [])
      .filter((a) => annSet.has(a.id))
      .map((a) => structuredClone(a));
    // Annotations live in their own channel, so an annotation-only selection
    // produces an annotations-only clipboard (see the paste fast path).
    if (selection.length === 0) {
      if (copiedAnnotations.length === 0) return;
      set({
        clipboard: {
          elements: [],
          buses: [],
          junctions: [],
          placements: {},
          busLayouts: {},
          wires: [],
          annotations: copiedAnnotations,
        },
        clipboardPasteIndex: 0,
      });
      return;
    }
    const sel = new Set(selection);

    const elements = diagram.elements
      .filter((e) => sel.has(e.id))
      .map((e) => structuredClone(e));

    const buses = (diagram.buses ?? [])
      .filter((b) => sel.has(b.id))
      .map((b) => structuredClone(b));

    const junctions = (diagram.junctions ?? [])
      .filter((j) => sel.has(j.id))
      .map((j) => {
        const cloned = structuredClone(j);
        if (!cloned.layout) {
          const world = internal.junctions.get(j.id)?.world;
          if (world) cloned.layout = { at: [world[0], world[1]] };
        }
        return cloned;
      });

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
      clipboard: {
        elements,
        buses,
        junctions,
        placements,
        busLayouts,
        wires,
        annotations: copiedAnnotations,
      },
      clipboardPasteIndex: 0,
    });
  },

  cutSelection: () => {
    const { selection, selectedAnnotations } = get();
    if (selection.length === 0 && selectedAnnotations.length === 0) return;
    get().copySelection();
    get().deleteSelection();
  },

  pasteClipboard: () => {
    const { clipboard, clipboardPasteIndex, diagram } = get();
    if (!clipboard) return;
    // Annotations-only clipboard: paste with the same cascade offset and
    // select the pasted copy (mirrors the element flow below).
    if (
      clipboard.elements.length === 0 &&
      clipboard.buses.length === 0 &&
      clipboard.junctions.length === 0
    ) {
      const anns = clipboard.annotations ?? [];
      if (anns.length === 0) return;
      const step = clipboardPasteIndex + 1;
      const off = PASTE_OFFSET * step;
      const newIds: AnnotationId[] = [];
      get().dispatch((d) => {
        let working = d;
        for (const ann of anns) {
          const id = newAnnotationId(working);
          newIds.push(id);
          const moved = {
            ...structuredClone(ann),
            id,
            at: [ann.at[0] + off, ann.at[1] + off] as [number, number],
          };
          working = {
            ...working,
            annotations: [...(working.annotations ?? []), moved],
          };
        }
        return working;
      });
      if (newIds.length) {
        set({
          selectedAnnotations: newIds,
          selection: [],
          selectedWire: null,
          selectedNode: null,
          clipboardPasteIndex: step,
        });
      }
      return;
    }
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
    for (const junction of clipboard.junctions) {
      const newId = newJunctionId(working);
      idMap.set(junction.id, newId);
      working = {
        ...working,
        junctions: [...(working.junctions ?? []), { id: newId }],
      };
    }

    // Mixed clipboard: annotations ride along with the elements, offset by the
    // same cascade step so the pasted copy keeps its relative arrangement.
    const newAnnotations: Annotation[] = [];
    for (const ann of clipboard.annotations ?? []) {
      const id = newAnnotationId(working);
      const moved = {
        ...structuredClone(ann),
        id,
        at: [ann.at[0] + dx, ann.at[1] + dy] as [number, number],
      };
      newAnnotations.push(moved);
      working = {
        ...working,
        annotations: [...(working.annotations ?? []), moved],
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

      const newJunctions: Junction[] = clipboard.junctions.map((j) => {
        const cloned = structuredClone(j);
        cloned.id = idMap.get(j.id)!;
        if (cloned.layout) {
          cloned.layout = {
            at: [cloned.layout.at[0] + dx, cloned.layout.at[1] + dy],
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
        return {
          id: wireIdFromEnds(ends[0], ends[1]),
          ends,
          ...(w.label ? { label: w.label } : {}),
        };
      });

      const wires = mergeWires(d.wires ?? [], newWires);

      return {
        ...d,
        elements: [...d.elements, ...newElements],
        buses: newBuses.length
          ? [...(d.buses ?? []), ...newBuses]
          : d.buses,
        junctions: newJunctions.length
          ? [...(d.junctions ?? []), ...newJunctions]
          : d.junctions,
        wires: wires.length ? wires : undefined,
        layout: Object.keys(newLayout).length ? newLayout : undefined,
        annotations: newAnnotations.length
          ? [...(d.annotations ?? []), ...newAnnotations]
          : d.annotations,
      };
    });

    set({
      selection: Array.from(idMap.values()),
      selectedAnnotations: newAnnotations.map((a) => a.id),
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

  moveElements: (deltas, annotationDeltas) => {
    if (deltas.size === 0 && !annotationDeltas?.size) return;
    const internal = get().internal;
    get().dispatch((d) => applyMoves(d, internal, deltas, annotationDeltas));
  },

  deleteSelection: () => {
    const { selection, selectedAnnotations } = get();
    if (selection.length === 0 && selectedAnnotations.length === 0) return;
    const ids = new Set(selection);
    const annIds = new Set(selectedAnnotations);
    get().dispatch((d) => {
      const elements = d.elements.filter((e) => !ids.has(e.id));
      const buses = (d.buses ?? []).filter((b) => !ids.has(b.id));
      const junctions = (d.junctions ?? []).filter((j) => !ids.has(j.id));
      const wires = (d.wires ?? []).filter(
        (w) => !ids.has(endOwner(w.ends[0])) && !ids.has(endOwner(w.ends[1])),
      );
      // Annotations are a separate channel but share the gesture, so they go
      // in the same dispatch — one undo entry for the whole mixed selection.
      const annotations = annIds.size
        ? (d.annotations ?? []).filter((a) => !annIds.has(a.id))
        : d.annotations;
      // Also drop junctions left orphaned by the wires we just removed.
      const prunedJunctions = pruneOrphanedJunctions(d.wires ?? [], wires, junctions);
      const layout = d.layout
        ? Object.fromEntries(
            Object.entries(d.layout).filter(([k]) => !ids.has(k)),
          )
        : undefined;
      // A binding whose target is gone is dead weight the viewer would have to
      // skip forever, so it goes with the element.
      return removeBindingsForTargets(
        {
          ...d,
          elements,
          buses: buses.length ? buses : undefined,
          junctions: prunedJunctions.length ? prunedJunctions : undefined,
          wires: wires.length ? wires : undefined,
          layout: layout && Object.keys(layout).length ? layout : undefined,
          annotations: annotations?.length ? annotations : undefined,
        },
        ids,
      );
    });
    set({
      selection: [],
      selectedAnnotations: [],
      editingAnnotation: null,
      editingCell: null,
    });
  },

  deleteSelectedWire: () => {
    const { selectedWire, internal } = get();
    if (!selectedWire) return;

    // Collect non-bus elements touching this wire so we can freeze their
    // current auto-layout positions into `diagram.layout`. Otherwise the
    // next compile re-runs auto-layout without the wire's anchor and the
    // element "flies" to a different spot.
    const wireObj = (get().diagram.wires ?? []).find((w) => w.id === selectedWire);
    const affectedElementIds = new Set<ElementId>();
    if (wireObj) {
      for (const end of wireObj.ends) {
        const dot = end.indexOf('.');
        if (dot > 0) affectedElementIds.add(end.slice(0, dot));
      }
    }

    get().dispatch((d) => {
      const oldWires = d.wires ?? [];
      const wires = oldWires.filter((w) => w.id !== selectedWire);
      if (wires.length === oldWires.length) return d;

      const layout = { ...(d.layout ?? {}) };
      for (const id of affectedElementIds) {
        if (layout[id]) continue;
        const resolved = internal.layout.get(id);
        if (!resolved) continue;
        layout[id] = compactPlacement(resolved);
      }

      const junctions = pruneOrphanedJunctions(oldWires, wires, d.junctions ?? []);

      return {
        ...d,
        wires: wires.length ? wires : undefined,
        junctions: junctions.length ? junctions : undefined,
        layout: Object.keys(layout).length ? layout : undefined,
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
        layout[id] = compactPlacement(resolved);
      }

      const oldWires = d.wires ?? [];
      const wires = oldWires.filter(
        (w) => !memberSet.has(w.ends[0]) && !memberSet.has(w.ends[1]),
      );
      const junctions = pruneOrphanedJunctions(oldWires, wires, d.junctions ?? []);
      return {
        ...d,
        wires: wires.length ? wires : undefined,
        junctions: junctions.length ? junctions : undefined,
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
        if (internal.junctions.has(id)) continue; // points don't rotate
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
        if (internal.junctions.has(id)) continue; // points don't mirror
        const cur = layout[id] ?? { at: internal.layout.get(id)?.at ?? [0, 0] };
        layout[id] = { ...cur, mirror: !(cur.mirror ?? false) };
      }
      return { ...d, layout };
    });
  },

  setSelectionColor: (color) => {
    const { selection, selectedAnnotations, selectedWire } = get();
    if (
      selection.length === 0 &&
      selectedAnnotations.length === 0 &&
      selectedWire == null
    )
      return;
    const ids = new Set(selection);
    const annIds = new Set(selectedAnnotations);
    // `default` is the ABSENCE of a colour, not a stored value — see the
    // interface note. Everything below goes through this one helper so the
    // rule cannot drift between object kinds.
    const paint = <T extends { color?: DiagramColor }>(o: T): T => {
      if (color === 'default') {
        if (o.color === undefined) return o;
        const { color: _drop, ...rest } = o;
        return rest as T;
      }
      return o.color === color ? o : { ...o, color };
    };
    // Build first and bail if nothing moved. Without this, recolouring a
    // junction-only selection (junctions have no colour) or re-picking the
    // colour something already is would push an undo entry that changes
    // nothing — and the user would press Ctrl+Z and watch nothing happen.
    const d = get().diagram;
    const elements = ids.size
      ? d.elements.map((e) => (ids.has(e.id) ? paint(e) : e))
      : d.elements;
    const buses = ids.size
      ? d.buses?.map((b) => (ids.has(b.id) ? paint(b) : b))
      : d.buses;
    // The wire channel is mutually exclusive with the element selection, but
    // handling both here keeps one action for "recolour what I have picked".
    const wires = selectedWire
      ? d.wires?.map((w) => (w.id === selectedWire ? paint(w) : w))
      : d.wires;
    const annotations = annIds.size
      ? d.annotations?.map((a) => (annIds.has(a.id) ? paint(a) : a))
      : d.annotations;
    const same = <T,>(a: readonly T[] | undefined, b: readonly T[] | undefined) =>
      a === b || (a?.length === b?.length && (a ?? []).every((x, i) => x === b?.[i]));
    if (
      same(elements, d.elements) &&
      same(buses, d.buses) &&
      same(wires, d.wires) &&
      same(annotations, d.annotations)
    )
      return;
    get().dispatch((cur) => ({ ...cur, elements, buses, wires, annotations }));
  },

  resetSelectionLabelOffset: () => {
    const ids = new Set(get().selection);
    if (ids.size === 0) return;
    const d = get().diagram;
    if (!d.elements.some((e) => ids.has(e.id) && e.labelOffset !== undefined)) {
      return;
    }
    get().dispatch((cur) => ({
      ...cur,
      elements: cur.elements.map((e) => {
        if (!ids.has(e.id) || e.labelOffset === undefined) return e;
        const { labelOffset: _drop, ...rest } = e;
        return rest;
      }),
    }));
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

  addJunction: (at) => {
    const id = newJunctionId(get().diagram);
    get().dispatch((d) => {
      const junction: Junction = { id, layout: { at } };
      return { ...d, junctions: [...(d.junctions ?? []), junction] };
    });
    set({ selection: [id] });
    return id;
  },

  updateJunction: (id, patch) => {
    get().dispatch((d) => ({
      ...d,
      junctions: (d.junctions ?? []).map((j) =>
        j.id === id ? { ...j, ...patch } : j,
      ),
    }));
  },

  mergeJunctionInto: (id, target) => {
    if (id === target) return;
    get().dispatch((d) => {
      const all = d.wires ?? [];
      const ids = new Set(all.filter((w) => !w.ends.includes(id)).map((w) => w.id));
      const wires: Wire[] = [];
      for (const w of all) {
        if (!w.ends.includes(id)) {
          wires.push(w);
          continue;
        }
        const ends = w.ends.map((e) => (e === id ? target : e)) as [WireEnd, WireEnd];
        if (ends[0] === ends[1]) continue;
        const nid = wireIdFromEnds(ends[0], ends[1]);
        if (ids.has(nid)) continue;
        ids.add(nid);
        // The old route ran to where the junction was; let the router redo it.
        const { path: _path, ...rest } = w;
        wires.push({ ...rest, id: nid, ends });
      }
      return {
        ...d,
        wires,
        junctions: (d.junctions ?? []).filter((j) => j.id !== id),
      };
    });
    const st = get();
    if (st.selection.includes(id)) st.setSelection(st.selection.filter((s) => s !== id));
  },

  setSelectedSheet: (id) =>
    set({
      selectedSheet: id,
      ...(id
        ? {
            selection: [],
            selectedWire: null,
            selectedNode: null,
            selectedAnnotations: [],
            editingAnnotation: null,
            editingCell: null,
            editingElement: null,
          }
        : {}),
    }),

  addSheet: (paper, orientation) => {
    const { diagram, internal } = get();
    const sheets = diagram.sheets ?? [];
    const id = nextSheetId(sheets);
    let sheet: Sheet;
    const last = sheets[sheets.length - 1];
    if (last) {
      // Next page: to the right of the last one, top-aligned, same scale.
      const r = sheetRect(last);
      const scale = clampSheetScale(last.scale);
      sheet = {
        id,
        paper,
        orientation,
        at: [Math.round(r.x + r.w + SHEET_GAP_MM * UNITS_PER_MM * scale), Math.round(r.y)],
        ...(scale !== 1 ? { scale } : {}),
      };
    } else {
      // First page: frame what is already drawn, enlarging the frame (never
      // the drawing) when the drawing is bigger than the paper.
      const box = drawingBox(diagram, internal);
      const scale = box ? fitScale(box.maxX - box.minX, box.maxY - box.minY, paper, orientation) : 1;
      const at = sheetAroundBox(box ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 }, paper, orientation, scale);
      sheet = { id, paper, orientation, at, ...(scale !== 1 ? { scale } : {}) };
    }
    get().dispatch((d) => ({ ...d, sheets: [...(d.sheets ?? []), sheet] }));
    get().setSelectedSheet(id);
    return id;
  },

  updateSheet: (id, patch) => {
    get().dispatch((d) => ({
      ...d,
      sheets: (d.sheets ?? []).map((sh) => {
        if (sh.id !== id) return sh;
        const next: Sheet = { ...sh, ...patch, id };
        // Empty text clears the field rather than storing "".
        for (const k of ['title', 'number', 'date', 'scaleText'] as const) {
          if (next[k] === '' || next[k] === undefined) delete next[k];
        }
        if (next.scale !== undefined) {
          const sc = clampSheetScale(next.scale);
          if (sc === 1) delete next.scale;
          else next.scale = sc;
        }
        return next;
      }),
    }));
  },

  removeSheet: (id) => {
    get().dispatch((d) => {
      const sheets = (d.sheets ?? []).filter((sh) => sh.id !== id);
      const next = { ...d, sheets };
      if (sheets.length === 0) delete (next as { sheets?: Sheet[] }).sheets;
      return next;
    });
    if (get().selectedSheet === id) set({ selectedSheet: null });
  },

  reorderSheet: (id, dir) => {
    const sheets = get().diagram.sheets ?? [];
    const i = sheets.findIndex((sh) => sh.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sheets.length) return;
    get().dispatch((d) => {
      const list = [...(d.sheets ?? [])];
      [list[i], list[j]] = [list[j], list[i]];
      return { ...d, sheets: list };
    });
  },

  moveSheet: (id, dx, dy) => {
    if (dx === 0 && dy === 0) return;
    const { diagram, internal } = get();
    const sheet = diagram.sheets?.find((sh) => sh.id === id);
    if (!sheet) return;
    const { elements, annotations } = sheetContentIds(diagram, internal, sheet);
    const deltas = new Map<ElementId, [number, number]>(elements.map((e) => [e, [dx, dy]]));
    const annDeltas = new Map<AnnotationId, [number, number]>(annotations.map((a) => [a, [dx, dy]]));
    get().dispatch((d) => {
      const moved = applyMoves(d, internal, deltas, annDeltas);
      return {
        ...moved,
        sheets: (moved.sheets ?? []).map((sh) =>
          sh.id === id ? { ...sh, at: [sh.at[0] + dx, sh.at[1] + dy] as [number, number] } : sh,
        ),
      };
    });
  },

  fitSheet: (id) => {
    const { diagram, internal } = get();
    const sheet = diagram.sheets?.find((sh) => sh.id === id);
    if (!sheet) return;
    const box = sheetContentBox(diagram, internal, sheet);
    if (!box) return;
    const scale = fitScale(box.maxX - box.minX, box.maxY - box.minY, sheet.paper, sheet.orientation);
    const at = sheetAroundBox(box, sheet.paper, sheet.orientation, scale);
    get().updateSheet(id, { scale, at });
  },

  enlargeLabelsForPrint: (id) => {
    const sheet = get().diagram.sheets?.find((sh) => sh.id === id);
    if (!sheet) return;
    const size = Math.min(32, Math.max(5, labelFontForPrint(sheet.scale)));
    get().dispatch((d) => ({ ...d, meta: { ...d.meta, labelFontSize: size } }));
  },

  updateTitleBlock: (patch) => {
    get().dispatch((d) => {
      const tb: TitleBlockShared = { ...d.meta?.titleBlock, ...patch };
      for (const k of Object.keys(tb) as (keyof TitleBlockShared)[]) {
        if (!tb[k]) delete tb[k];
      }
      const meta: DiagramMeta = { ...d.meta, titleBlock: tb };
      if (Object.keys(tb).length === 0) delete meta.titleBlock;
      return { ...d, meta };
    });
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

  connectWire: (from, to) => {
    get().dispatch((d) => {
      let working = d;
      const usedIds = new Set<string>([
        ...working.elements.map((e) => e.id),
        ...(working.buses ?? []).map((b) => b.id),
        ...(working.junctions ?? []).map((j) => j.id),
      ]);
      const mintJunctionId = (): JunctionId => {
        let n = 1;
        while (usedIds.has(`J${n}`)) n++;
        const id = `J${n}`;
        usedIds.add(id);
        return id;
      };
      const addJunctionAt = (at: [number, number]): JunctionId => {
        const id = mintJunctionId();
        working = {
          ...working,
          junctions: [...(working.junctions ?? []), { id, layout: { at } }],
        };
        return id;
      };
      // Resolve a spec to a concrete WireEnd, performing any junction mint /
      // wire split as a side effect on `working`.
      const resolve = (spec: WireEndSpec): WireEnd | null => {
        if ('end' in spec) return spec.end;
        if ('junctionAt' in spec) return addJunctionAt(spec.junctionAt);
        // onWire: split the host wire at the tap point.
        const host = (working.wires ?? []).find((w) => w.id === spec.onWire);
        const jid = addJunctionAt(spec.at);
        if (!host) return jid;
        const rest = (working.wires ?? []).filter((w) => w.id !== spec.onWire);
        // Both halves stay the same conductor, so each keeps the host's label.
        const half = (a: WireEnd, b: WireEnd): Wire => ({
          id: wireIdFromEnds(a, b),
          ends: [a, b],
          ...(host.label ? { label: host.label } : {}),
        });
        working = {
          ...working,
          wires: mergeWires(rest, [
            half(host.ends[0], jid),
            half(jid, host.ends[1]),
          ]),
        };
        return jid;
      };
      const a = resolve(from);
      const b = resolve(to);
      if (a === null || b === null || a === b) return working;
      const id = wireIdFromEnds(a, b);
      const existing = working.wires ?? [];
      if (existing.some((w) => w.id === id)) return working;
      return { ...working, wires: [...existing, { id, ends: [a, b] }] };
    });
  },

  updateWirePath: (id, path) => {
    get().dispatch((d) => {
      const wires = d.wires ?? [];
      if (!wires.some((w) => w.id === id)) return d;
      const cleaned = path && path.length >= 2 ? normalizePath(path) : null;
      const valid = cleaned && cleaned.length >= 2 ? cleaned : null;
      const nextWires = wires.map((w) => {
        if (w.id !== id) return w;
        if (valid) return { ...w, path: valid };
        const { path: _drop, ...rest } = w;
        return rest as Wire;
      });
      return { ...d, wires: nextWires };
    });
  },

  resetWirePath: (id) => {
    get().updateWirePath(id, null);
  },

  updateWire: (id, patch) => {
    get().dispatch((d) => {
      const wires = d.wires ?? [];
      if (!wires.some((w) => w.id === id)) return d;
      return {
        ...d,
        wires: wires.map((w) => (w.id === id ? { ...w, ...patch } : w)),
      };
    });
  },

  setHealthDismissed: (issueId, dismissed) => {
    get().dispatch((d) => {
      const list = new Set(d.meta?.healthDismissed ?? []);
      if (dismissed === list.has(issueId)) return d;
      if (dismissed) list.add(issueId);
      else list.delete(issueId);
      const { healthDismissed: _old, ...rest } = d.meta ?? {};
      const meta = list.size ? { ...rest, healthDismissed: [...list].sort() } : rest;
      return { ...d, meta: Object.keys(meta).length ? meta : undefined };
    });
  },

  changeKind: (id, kind) => {
    const def = libraryById[kind];
    if (!def) return;
    const keep = new Set((def.params ?? []).map((p) => p.name));
    const from = get().diagram.elements.find((e) => e.id === id)?.kind;
    if (!from || from === kind) return;
    const fam = familyOf(kind);
    const flip = !!fam?.mirrorOnSwap && fam.kinds.includes(from);
    get().dispatch((d) => {
      const elements = d.elements.map((e) => {
        if (e.id !== id) return e;
        const { state: _state, params, ...rest } = e;
        const kept = Object.entries(params ?? {}).filter(([k]) => keep.has(k));
        return kept.length > 0
          ? { ...rest, kind, params: Object.fromEntries(kept) }
          : { ...rest, kind };
      });
      const place = d.layout?.[id];
      if (!flip || !place) return { ...d, elements };
      // Mirror images: flipping `mirror` puts the new kind's terminal exactly
      // where the old one's was (mirror is applied before rotation).
      const { mirror, ...rest } = place;
      const next = mirror ? rest : { ...rest, mirror: true };
      return { ...d, elements, layout: { ...d.layout, [id]: next } };
    });
  },

  updateElement: (id, patch) => {
    get().dispatch((d) => ({
      ...d,
      elements: d.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  },

  updatePlacement: (id, patch) => {
    get().dispatch(placementMutator(id, patch, () => get().internal));
  },

  previewPlacement: (id, patch) => {
    const { diagram, gestureBase } = get();
    const next = placementMutator(id, patch, () => get().internal)(diagram);
    if (next === diagram) return;
    set({
      diagram: next,
      internal: compile(next),
      gestureBase: gestureBase ?? diagram,
    });
  },

  endGesture: (commit) => {
    const { diagram, gestureBase, past } = get();
    if (!gestureBase) return;
    if (!commit || diagram === gestureBase) {
      set({ diagram: gestureBase, internal: compile(gestureBase), gestureBase: null });
      return;
    }
    const trimmed = past.length >= HISTORY_LIMIT ? past.slice(1) : past;
    set({ past: [...trimmed, gestureBase], future: [], gestureBase: null });
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
  insertAnnotation: (ann) => {
    const id = newAnnotationId(get().diagram);
    get().dispatch((d) => ({
      ...d,
      annotations: [...(d.annotations ?? []), { ...ann, id } as Annotation],
    }));
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
  removeCustomKind: (kindId) => {
    const d = get().diagram;
    const inUse = d.elements.filter((e) => e.kind === kindId).length;
    if (inUse > 0) return inUse;
    if (!(d.customKinds ?? []).some((k) => k.id === kindId)) return 0;
    get().dispatch((doc) => {
      const next = (doc.customKinds ?? []).filter((k) => k.id !== kindId);
      return { ...doc, customKinds: next.length ? next : undefined };
    }, 'remove custom kind');
    return 0;
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
    if (get().selectedAnnotations.includes(id)) {
      set({
        selectedAnnotations: get().selectedAnnotations.filter((x) => x !== id),
        editingAnnotation: null,
        editingCell: null,
      });
    }
    if (get().annotationPreview?.id === id) {
      set({ annotationPreview: null });
    }
  },
});

export const useEditorStore = create<EditorState>()(
  persist(
    createEditorState,
    {
      name: 'ole-editor',
      version: 2,
      // A read-only viewer instance shares this storage key with the editor.
      // Suppress all writes while read-only so force-seeding a shared diagram
      // never overwrites the user's autosaved document.
      storage: createJSONStorage(() => ({
        getItem: (name) => localStorage.getItem(name),
        setItem: (name, value) => {
          if (useEditorStore.getState().readOnly) return;
          localStorage.setItem(name, value);
        },
        removeItem: (name) => localStorage.removeItem(name),
      })),
      partialize: (s) => ({
        diagram: s.diagram,
        activeTool: s.activeTool,
        placeKind: s.placeKind,
        lastPlaceKind: s.lastPlaceKind,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.diagram) {
          state.diagram = migrateLegacyFrame(state.diagram);
          state.internal = compile(state.diagram);
        }
      },
    },
  ),
);

/**
 * A private, NON-persisted editor store.
 *
 * `useEditorStore` is a module singleton wired to `localStorage`, which is
 * right for the editor (one document per page, survives reload) and wrong for
 * a viewer: a monitoring dashboard may mount several diagrams side by side,
 * next to an editor, and none of them may touch the user's autosaved draft.
 * Each `<OneLineViewer>` owns one of these and hands it to the canvas layers
 * through `EditorStoreContext`, so the very same layer components render
 * either store.
 */
export function createEditorStore(): StoreApi<EditorState> {
  return createStore<EditorState>()(createEditorState);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The one annotation that *is* the entire selection, or null.
 *
 * Annotation editing affordances — the resize/vertex handles, the annotation
 * property panel, click-again-to-edit — are single-target by nature, so they
 * derive from `selectedAnnotations` instead of storing a second, drift-prone
 * copy of it. A mixed or multi-annotation selection deliberately resolves to
 * null: showing resize grips for one member of a group reads as a bug.
 */
export function soleSelectedAnnotation(s: EditorState): AnnotationId | null {
  return s.selectedAnnotations.length === 1 && s.selection.length === 0
    ? s.selectedAnnotations[0]
    : null;
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
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
    ...scaleField(rp.scale),
  };
}

/** The one way a placement patch is applied — shared by the committed edit
 *  and the live drag preview so the two can never disagree. A device that
 *  auto-layout placed has no layout entry; it is materialised from where it
 *  renders, so resizing it doesn't also make it jump. */
function placementMutator(
  id: ElementId,
  patch: Partial<Placement>,
  internal: () => InternalModel,
): (d: DiagramFile) => DiagramFile {
  return (d) => {
    const cur = d.layout?.[id] ?? internal().layout.get(id);
    const nextPlacement: Placement = {
      at: patch.at ?? cur?.at ?? [0, 0],
      ...(patch.rot !== undefined ? { rot: patch.rot } : cur?.rot ? { rot: cur.rot } : {}),
      ...(patch.mirror !== undefined
        ? { mirror: patch.mirror }
        : cur?.mirror ? { mirror: cur.mirror } : {}),
      ...scaleField(patch.scale !== undefined ? patch.scale : cur?.scale),
    };
    return {
      ...d,
      layout: { ...(d.layout ?? {}), [id]: nextPlacement },
    };
  };
}

/** `{ scale }` for a non-default size, `{}` for 1/absent — the file omits it. */
function scaleField(s: number | undefined): { scale?: number } {
  if (s === undefined) return {};
  const c = clampSymbolScale(s);
  return c === 1 ? {} : { scale: c };
}

function compactBusLayout(g: BusGeometry): BusLayout {
  return {
    at: [g.at[0], g.at[1]],
    span: g.span,
    ...(g.rot ? { rot: g.rot } : {}),
  };
}
