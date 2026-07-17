import type { LibraryEntry } from './library';

export type DiagramVersion = '1';
export type ElementId = string;
export type PinName = string;
export type NodeId = string;
export type BusId = ElementId;
export type JunctionId = ElementId;
export type WireId = string;
/** "elementId.pinName" — dotted form for device pins. */
export type TerminalRef = `${ElementId}.${PinName}`;
/**
 * A wire endpoint. Either a device terminal ("X.Y") or a bare **node** id —
 * a bus id or a junction id. Disambiguated by the presence of a `.`: dotted is
 * always a device pin, bare is a node resolved against `buses` then `junctions`
 * (node ids share one namespace, so the two never collide).
 */
export type WireEnd = TerminalRef | BusId | JunctionId;
export type ParamValue = number | string | boolean;
export type LabelMode = 'off' | 'id' | 'all';

export interface DiagramFile {
  version: DiagramVersion;
  meta?: DiagramMeta;
  /** Devices only. Buses live in `buses`. */
  elements: Element[];
  /** Bus collection. Each bus is a hyperedge node, not an element. */
  buses?: Bus[];
  /**
   * Junction collection. A junction is a free-standing point connection node —
   * a first-class peer to `Bus` (it has geometry but no span). Wires meeting at
   * a junction share one electrical node, so junctions back free point-to-point
   * wiring without abusing buses.
   */
  junctions?: Junction[];
  /** Binary line segments between two endpoints (terminal pin, bus, or junction). */
  wires?: Wire[];
  /** Device placements only. Bus geometry lives in `Bus.layout`. */
  layout?: Record<ElementId, Placement>;
  /** Free annotations (text / rect / line / table). Typeless = text. */
  annotations?: Annotation[];
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

export interface Junction {
  id: JunctionId;
  name?: string;
  note?: string;
  params?: Record<string, ParamValue>;
  /** If absent, auto-layout computes the point (midpoint of wire neighbors). */
  layout?: JunctionLayout;
}

export interface JunctionLayout {
  at: [number, number];
}

export interface Wire {
  id: WireId;
  ends: [WireEnd, WireEnd];
  /** Optional manual route path. Absent → auto-route. */
  path?: [number, number][];
  /**
   * Optional display label rendered at the wire's midpoint (e.g. phase
   * designations "L1" / "L2" / "L3" / "N" / "PE"). Pure decoration — has no
   * effect on routing or connectivity.
   */
  label?: string;
}

export interface Placement {
  at: [number, number];
  rot?: 0 | 90 | 180 | 270;
  mirror?: boolean;
}

export type AnnotationId = string;

/** Stroke style shared by rect / line annotations. */
export type AnnotationStroke = 'solid' | 'dashed';
/** Rect fill: `tint` is a faint foreground wash that never occludes content. */
export type AnnotationFill = 'none' | 'tint';
/** Arrowheads on a line annotation (leader / callout use). */
export type LineArrow = 'none' | 'end' | 'both';

/**
 * Free annotations — decoration layered over the diagram, never part of the
 * electrical model. Discriminated on `type`; a missing `type` means `text`
 * (files written before rect/line/table existed carry bare text annotations).
 *
 * Every variant anchors at `at` so "move annotation" is uniformly "patch
 * `at`" — line points are stored *relative* to `at` for the same reason.
 */
export interface TextAnnotation {
  id: AnnotationId;
  type?: 'text';
  at: [number, number];
  text: string;
  fontSize?: number;
}

/**
 * Rectangle — plain box or a labeled group frame (dashed box around a
 * cabinet / section). Purely decorative: it never owns the elements inside
 * it, and its interior is click-transparent so content stays selectable.
 */
export interface RectAnnotation {
  id: AnnotationId;
  type: 'rect';
  at: [number, number];
  size: [number, number];
  /** Default `dashed` — the group-frame convention. */
  stroke?: AnnotationStroke;
  /** Default `none`. */
  fill?: AnnotationFill;
  /** Optional caption drawn inside the top-left corner. */
  label?: string;
}

/** Straight/poly line, optionally arrowed (leader lines, dividers). */
export interface LineAnnotation {
  id: AnnotationId;
  type: 'line';
  at: [number, number];
  /** ≥2 vertices, relative to `at`. */
  points: [number, number][];
  /** Default `solid`. */
  stroke?: AnnotationStroke;
  /** Default `none`. */
  arrow?: LineArrow;
}

/** Freehand grid table; cells are plain single-line text. */
export interface TableAnnotation {
  id: AnnotationId;
  type: 'table';
  at: [number, number];
  colWidths: number[];
  rowHeights: number[];
  /** `cells[row][col]`, sized `rowHeights.length × colWidths.length`. */
  cells: string[][];
  fontSize?: number;
}

export type Annotation =
  | TextAnnotation
  | RectAnnotation
  | LineAnnotation
  | TableAnnotation;

/** `type` of an annotation with the text default applied. */
export type AnnotationKind = 'text' | 'rect' | 'line' | 'table';

export function annotationKind(a: Annotation): AnnotationKind {
  return a.type ?? 'text';
}

export function isTextAnnotation(a: Annotation): a is TextAnnotation {
  return a.type === undefined || a.type === 'text';
}

/**
 * Loose patch type for `updateAnnotation` — a partial over the union of all
 * variant fields (minus identity). The store merge preserves the original
 * `type`, so a patch can only touch fields meaningful to that variant.
 */
export type AnnotationPatch = Partial<
  Omit<TextAnnotation, 'id' | 'type'> &
    Omit<RectAnnotation, 'id' | 'type'> &
    Omit<LineAnnotation, 'id' | 'type'> &
    Omit<TableAnnotation, 'id' | 'type'>
>;
