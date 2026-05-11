/**
 * Runtime-only model (`InternalModel`) — what the renderer consumes. Compiled
 * from `DiagramFile`; never serialized. Indexed for O(1) per-element lookup.
 */

import type {
  Bus,
  BusId,
  Element,
  ElementId,
  LibraryEntry,
  NodeId,
  Orientation,
  Placement,
  TerminalRef,
  WireEnd,
} from '../model';

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
}

export interface InternalModel {
  elements: Map<ElementId, ResolvedElement>;
  buses: Map<BusId, ResolvedBus>;
  terminals: Map<TerminalRef, TerminalGeometry>;
  nodes: Map<NodeId, ConnectivityNode>;
  layout: Map<ElementId, ResolvedPlacement>;
  /** Rendered polyline per wire id. */
  wireRenders: Map<import('../model').WireId, WireRender>;
  terminalToNode: Map<WireEnd, NodeId>;
  elementToTerminals: Map<ElementId, TerminalRef[]>;
  diagnostics: Diagnostic[];
}

export function emptyInternalModel(): InternalModel {
  return {
    elements: new Map(),
    buses: new Map(),
    terminals: new Map(),
    nodes: new Map(),
    layout: new Map(),
    wireRenders: new Map(),
    terminalToNode: new Map(),
    elementToTerminals: new Map(),
    diagnostics: [],
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
