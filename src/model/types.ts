import type { LibraryEntry } from './library';

export type DiagramVersion = '1';
export type ElementId = string;
export type PinName = string;
export type NodeId = string;
/** "elementId.pinName". Busbar taps use the virtual pin "<busId>.tap". */
export type TerminalRef = `${ElementId}.${PinName}`;
export type ParamValue = number | string | boolean;
export type LabelMode = 'off' | 'id' | 'all';

export interface DiagramFile {
  version: DiagramVersion;
  meta?: DiagramMeta;
  elements: Element[];
  /** Each entry: terminals sharing one electrical node. */
  connections?: Connection[];
  /** Missing keys → auto-layout. */
  layout?: Record<ElementId, Placement>;
  /** User-edited wire paths only; missing keys → auto-route. */
  routes?: Record<NodeId, Route>;
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

export type Connection = TerminalRef[];

export interface Placement {
  at: [number, number];
  rot?: 0 | 90 | 180 | 270;
  mirror?: boolean;
  /** Length along the stretch axis; busbar only. */
  span?: number;
}

export interface Route {
  path: [number, number][];
}

export type AnnotationId = string;

export interface TextAnnotation {
  id: AnnotationId;
  at: [number, number];
  text: string;
  fontSize?: number;
}
