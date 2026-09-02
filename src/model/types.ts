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

/**
 * Which graphical standard a drawing renders its symbols in.
 *
 * A drawing is IEC *or* ANSI — never a mix — so this is a document setting,
 * not a per-element one. Absent = `iec`, which is what every diagram written
 * before this field existed renders as.
 *
 * Switching it changes only how symbols are DRAWN. Terminal coordinates,
 * connectivity, wiring and layout are identical in both, by construction: a
 * variant may not declare its own terminals (see `LibraryVariant`). Flipping
 * the standard on a finished drawing must never move or re-route anything.
 */
export type SymbolStandard = 'iec' | 'ansi';

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
  /**
   * Symbol definitions that live in THIS document rather than in the built-in
   * library. Same `LibraryEntry` contract as a built-in, so a custom kind is a
   * real device everywhere it matters: it compiles, wires up, joins
   * connectivity nodes, reports diagnostics, and exports to DXF through
   * exactly the paths a built-in does — no parallel rendering or export
   * machinery exists for it, by design.
   *
   * Embedded rather than referenced on purpose. A diagram travels: public
   * `/v/:id` links, forks, downloaded files. A reference would mean the
   * recipient opens a drawing full of kinds they cannot resolve. A user-level
   * library is a catalogue you copy FROM, never a dependency you point AT.
   *
   * Ids are namespaced (`custom:…`) so they cannot collide with a built-in and
   * read as custom at a glance.
   */
  customKinds?: LibraryEntry[];
}

export interface DiagramMeta {
  title?: string;
  description?: string;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
  labelMode?: LabelMode;
  /**
   * Type size for element + wire labels, in canvas units. Document-level:
   * "make the labels readable on an A4 print" is a per-drawing decision, so
   * there is deliberately no per-element override.
   *
   * Absent → 7 (`LABEL_FONT_SIZE`), which is what every diagram written before
   * this field existed renders at. Values are clamped to
   * `LABEL_FONT_SIZE_MIN…MAX` (5–32, the same range the free-text annotation
   * picker offers) by every renderer.
   */
  labelFontSize?: number;
  /**
   * Graphical standard for the symbols. Absent → `iec`.
   *
   * Requested as "give selection of symbol variation. in example for Circuit
   * breaker, we can select either to use IEC symbol or ANSI" — and it is a
   * per-DRAWING choice because that is how the choice is actually made: a
   * drawing follows one standard throughout, and a sheet mixing an IEC breaker
   * with an ANSI one is a mistake, not a feature.
   */
  symbolStandard?: SymbolStandard;
}

export interface Element {
  id: ElementId;
  /** LibraryEntry.id (see src/element-library/). */
  kind: LibraryEntry['id'] | (string & {});
  name?: string;
  note?: string;
  params?: Record<string, ParamValue>;
  state?: Record<string, ParamValue>;
  /**
   * Ink colour of the symbol. Purely presentational — it never reaches the
   * compiler, connectivity or diagnostics. Absent = theme ink.
   */
  color?: DiagramColor;
  /**
   * User nudge for the structural label block, in WORLD units, applied on top
   * of the anchor the library declares. Absent = the library's own placement,
   * which is what every diagram written before this field existed renders.
   *
   * World space, not library space, because this is set by dragging the label
   * on the canvas: it must stay exactly where it was dropped, including after
   * the symbol is rotated or mirrored. It moves the block only — the text
   * alignment still follows the side of the symbol the anchor sits on.
   */
  labelOffset?: [number, number];
}

export interface Bus {
  id: BusId;
  name?: string;
  note?: string;
  params?: Record<string, ParamValue>;
  /** If absent, auto-layout computes geometry. */
  layout?: BusLayout;
  /** Ink colour. Colour-coding busbars was the single most-asked-for use. */
  color?: DiagramColor;
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
  /** Ink colour. Presentational only — routing and connectivity ignore it. */
  color?: DiagramColor;
}

export interface Placement {
  at: [number, number];
  rot?: 0 | 90 | 180 | 270;
  mirror?: boolean;
}

export type AnnotationId = string;

/**
 * Ink colour for anything drawn on the canvas — devices, buses, wires and
 * free annotations alike.
 *
 * A closed set of NAMES rather than free hex, because the canvas has a dark
 * theme: a literal colour cannot follow it, so a user who picked black would
 * watch their drawing disappear the moment they switched. Each name resolves
 * to a light/dark pair (and a DXF ACI index) in `lib/colors.ts`, so the same
 * choice reads correctly in both themes and survives export to CAD.
 *
 * `default` deliberately means "whatever ink the theme uses" — absent is the
 * same as `default`, which is why every colour field is optional and why a
 * diagram written before colours existed renders byte-identically.
 */
export type DiagramColor =
  | 'default'
  | 'red'
  | 'blue'
  | 'green'
  | 'amber'
  | 'gray';

/** Stroke style shared by rect / ellipse / line annotations. */
export type AnnotationStroke = 'solid' | 'dashed' | 'dotted';
/** Stroke weight for shape annotations, in nominal canvas units. */
export type AnnotationStrokeWidth = 1 | 2 | 3;
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
  color?: DiagramColor;
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
  /** Default 1. */
  strokeWidth?: AnnotationStrokeWidth;
  /** Default `none`. */
  fill?: AnnotationFill;
  /** Default `default` (theme ink). */
  color?: DiagramColor;
  /** Optional caption drawn inside the top-left corner. */
  label?: string;
}

/**
 * Ellipse / circle — the shape the rect tool could never stand in for.
 *
 * Anchored by its BOUNDING BOX (`at` = top-left, `size` = w×h) rather than
 * centre+radii, so every box-shaped affordance already written for rects —
 * the 8 resize grips, the drag-to-draw gesture, the bbox helpers, marquee
 * hit-testing — applies unchanged. Shift while drawing constrains to a circle.
 */
export interface EllipseAnnotation {
  id: AnnotationId;
  type: 'ellipse';
  at: [number, number];
  size: [number, number];
  /** Default `solid` — unlike a rect, an ellipse is a drawn shape, not a frame. */
  stroke?: AnnotationStroke;
  /** Default 1. */
  strokeWidth?: AnnotationStrokeWidth;
  /** Default `none`. */
  fill?: AnnotationFill;
  /** Default `default` (theme ink). */
  color?: DiagramColor;
  /** Optional caption drawn inside the top-left of the bounding box. */
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
  /** Default 1. */
  strokeWidth?: AnnotationStrokeWidth;
  /** Default `default` (theme ink). */
  color?: DiagramColor;
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
  color?: DiagramColor;
}

export type Annotation =
  | TextAnnotation
  | RectAnnotation
  | EllipseAnnotation
  | LineAnnotation
  | TableAnnotation;

/** `type` of an annotation with the text default applied. */
export type AnnotationKind = 'text' | 'rect' | 'ellipse' | 'line' | 'table';

/**
 * The box-anchored shapes. They share `at` + `size`, which is the whole reason
 * the resize grips and bbox code can treat them as one thing.
 */
export type BoxAnnotation = RectAnnotation | EllipseAnnotation;

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
    Omit<EllipseAnnotation, 'id' | 'type'> &
    Omit<LineAnnotation, 'id' | 'type'> &
    Omit<TableAnnotation, 'id' | 'type'>
>;
