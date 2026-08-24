/**
 * Runtime-only model (`InternalModel`) — what the renderer consumes. Compiled
 * from `DiagramFile`; never serialized. Indexed for O(1) per-element lookup.
 */

import type {
  Bus,
  BusId,
  Element,
  ElementId,
  Junction,
  JunctionId,
  LibraryEntry,
  NodeId,
  Orientation,
  Placement,
  TerminalRef,
  WireEnd,
} from '../model';
import { LIBRARY } from './library-index';

/** Element + the resolved library record for its `kind`. */
export interface ResolvedElement {
  element: Element;
  /** Undefined if `kind` is unknown to the library — render as placeholder. */
  libraryDef?: LibraryEntry;
}

/** Placement after defaults applied (rot=0, mirror=false). Devices only. */
export interface ResolvedPlacement {
  at: [number, number];
  rot: 0 | 90 | 180 | 270;
  mirror: boolean;
}

/** Bus geometry resolved at compile time. `axis` derived from `rot`. */
export interface BusGeometry {
  at: [number, number];
  span: number;
  rot: 0 | 90 | 180 | 270;
  axis: 'x' | 'y';
}

export interface ResolvedBus {
  bus: Bus;
  geometry: BusGeometry;
}

export interface ResolvedJunction {
  junction: Junction;
  /** Canvas coordinate of the point node. */
  world: [number, number];
  /**
   * How many wire ends terminate at this junction. Drives the solder-dot
   * convention: a visible dot is only *required* where 3+ conductors meet
   * (T / cross). Degree ≤ 2 is a corner or pass-through — no dot needed, and
   * a dot there would falsely read as a tap. The renderer hides low-degree
   * dots until the user interacts; export omits them entirely.
   */
  degree: number;
}

export interface TerminalGeometry {
  ref: TerminalRef;
  elementId: ElementId;
  pin: string;
  /** Canvas coordinates (after rot/mirror/translate). */
  world: [number, number];
  /** Cardinal direction the terminal exits in canvas frame. */
  orientation: Orientation;
}

export interface ConnectivityNode {
  id: NodeId;
  /** Mixed: device terminal refs (`X.Y`) and bare bus ids (`X`). */
  terminals: WireEnd[];
}

/** Compile-time issue. Non-fatal; renderer keeps drawing. */
export interface Diagnostic {
  /** Stable code (`E001`..`W999`). */
  code: string;
  severity: 'error' | 'warning';
  message: string;
  /** JSON Pointer pointing into the source DiagramFile, when applicable. */
  pointer?: string;
}

/**
 * Per-wire rendered path. One polyline per visible wire in the diagram.
 * Selection / hit-test / user-route override all key on `wireId`.
 */
export interface WireRender {
  wireId: import('../model').WireId;
  path: [number, number][];
  /** True if this came from `Wire.path` (user-edited); false = auto-routed. */
  userEdited?: boolean;
  /** Display label carried over from `Wire.label` (phase designation etc.). */
  label?: string;
  /** Ink colour carried over from `Wire.color`. Same pass-through as `label`:
   *  the canvas and the exporters both read the compiled model, so copying it
   *  here keeps them from disagreeing about a wire's colour. */
  color?: import('../model').DiagramColor;
}

export interface InternalModel {
  elements: Map<ElementId, ResolvedElement>;
  buses: Map<BusId, ResolvedBus>;
  junctions: Map<JunctionId, ResolvedJunction>;
  terminals: Map<TerminalRef, TerminalGeometry>;
  nodes: Map<NodeId, ConnectivityNode>;
  layout: Map<ElementId, ResolvedPlacement>;
  /** Rendered polyline per wire id. */
  wireRenders: Map<import('../model').WireId, WireRender>;
  terminalToNode: Map<WireEnd, NodeId>;
  elementToTerminals: Map<ElementId, TerminalRef[]>;
  diagnostics: Diagnostic[];
  /**
   * The kinds this document can resolve: the built-in library plus its own
   * `customKinds`, merged once per compile.
   *
   * It lives here because `getLibraryEntry` is a module-level lookup and a
   * custom kind is per-document — a global function has no way to know which
   * drawing is asking. Everything that needs to resolve a kind (the palette,
   * the place ghost, the property panel, the agent's geometry checks) already
   * holds the compiled model, so putting the merged view on it means one
   * source of truth instead of each consumer doing its own merge and drifting.
   */
  library: ReadonlyMap<string, LibraryEntry>;
}

export function emptyInternalModel(): InternalModel {
  return {
    elements: new Map(),
    buses: new Map(),
    junctions: new Map(),
    terminals: new Map(),
    nodes: new Map(),
    layout: new Map(),
    wireRenders: new Map(),
    terminalToNode: new Map(),
    elementToTerminals: new Map(),
    diagnostics: [],
    library: LIBRARY,
  };
}

export function resolvePlacement(p?: Placement): ResolvedPlacement {
  return {
    at: p?.at ?? [0, 0],
    rot: p?.rot ?? 0,
    mirror: p?.mirror ?? false,
  };
}

export function busAxisFromRot(rot: 0 | 90 | 180 | 270): 'x' | 'y' {
  return rot === 90 || rot === 270 ? 'y' : 'x';
}
