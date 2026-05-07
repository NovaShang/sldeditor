/**
 * Runtime-only model (`InternalModel`) — what the renderer consumes. Compiled
 * from `DiagramFile`; never serialized. Indexed for O(1) per-element lookup.
 */

import type {
  Element,
  ElementId,
  LibraryEntry,
  NodeId,
  Orientation,
  Placement,
  TerminalRef,
} from '@/model';

/** Element + the resolved library record for its `kind`. */
export interface ResolvedElement {
  element: Element;
  /** Undefined if `kind` is unknown to the library — render as placeholder. */
  libraryDef?: LibraryEntry;
}

/** Placement after defaults applied (rot=0, mirror=false). `span` carried through. */
export interface ResolvedPlacement {
  at: [number, number];
  rot: 0 | 90 | 180 | 270;
  mirror: boolean;
  span?: number;
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
  /** Optional human-given name (from `NamedConnection.name`). */
  name?: string;
  /** All terminals on this node, including those originating from `bus.tap`. */
  terminals: TerminalRef[];
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
 * Internal route representation. Supports multiple polylines per node so a
 * bus node can stub each external terminal independently. The serialized
 * `Route.path` (single polyline) maps to `paths: [path]` on import; on export
 * we'll only persist the user-edited paths anyway.
 */
export interface InternalRoute {
  paths: [number, number][][];
  manual?: boolean;
}

export interface InternalModel {
  elements: Map<ElementId, ResolvedElement>;
  terminals: Map<TerminalRef, TerminalGeometry>;
  nodes: Map<NodeId, ConnectivityNode>;
  layout: Map<ElementId, ResolvedPlacement>;
  routes: Map<NodeId, InternalRoute>;
  terminalToNode: Map<TerminalRef, NodeId>;
  elementToTerminals: Map<ElementId, TerminalRef[]>;
  diagnostics: Diagnostic[];
}

export function emptyInternalModel(): InternalModel {
  return {
    elements: new Map(),
    terminals: new Map(),
    nodes: new Map(),
    layout: new Map(),
    routes: new Map(),
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
    span: p?.span,
  };
}
