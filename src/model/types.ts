import type { LibraryEntry } from './library';

export type DiagramVersion = '1';
export type ElementId = string;
export type PinName = string;
export type NodeId = string;
export type BusId = ElementId;
export type WireId = string;
/** "elementId.pinName" — dotted form for device pins. */
export type TerminalRef = `${ElementId}.${PinName}`;
/**
 * Either a device terminal ("X.Y") or a bare bus id ("X"). Disambiguated by
 * the presence of a `.` — bus ids are never dotted.
 */
export type WireEnd = TerminalRef | BusId;
export type ParamValue = number | string | boolean;
export type LabelMode = 'off' | 'id' | 'all';

export interface DiagramFile {
  version: DiagramVersion;
  meta?: DiagramMeta;
  /** Devices only. Buses live in `buses`. */
  elements: Element[];
  /** Bus collection. Each bus is a hyperedge node, not an element. */
  buses?: Bus[];
  /** Binary line segments between two endpoints (terminal pin or bare bus id). */
  wires?: Wire[];
  /** Device placements only. Bus geometry lives in `Bus.layout`. */
  layout?: Record<ElementId, Placement>;
  annotations?: TextAnnotation[];
}

export interface DiagramMeta {
  title?: string;
  description?: string;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
  labelMode?: LabelMode;
}

export interface Element {
  id: ElementId;
  /** LibraryEntry.id (see src/element-library/). */
  kind: LibraryEntry['id'] | (string & {});
  name?: string;
  note?: string;
  params?: Record<string, ParamValue>;
  state?: Record<string, ParamValue>;
}

export interface Bus {
  id: BusId;
  name?: string;
  note?: string;
  params?: Record<string, ParamValue>;
  /** If absent, auto-layout computes geometry. */
  layout?: BusLayout;
}

export interface BusLayout {
  at: [number, number];
  span: number;
  rot?: 0 | 90 | 180 | 270;
}

export interface Wire {
  id: WireId;
  ends: [WireEnd, WireEnd];
  /** Optional manual route path. Absent → auto-route. */
  path?: [number, number][];
}

export interface Placement {
  at: [number, number];
  rot?: 0 | 90 | 180 | 270;
  mirror?: boolean;
}

export type AnnotationId = string;

export interface TextAnnotation {
  id: AnnotationId;
  at: [number, number];
  text: string;
  fontSize?: number;
}
