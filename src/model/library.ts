import type { SymbolStandard } from './types';

/**
 * Schema for the element library: one JSON file per symbol under
 * `src/element-library/`, e.g. `breaker.json`. Frontends auto-discover via
 * `import.meta.glob('./*.json')`.
 *
 * `LibraryEntry.id` is the canonical value of `Element.kind` in DiagramFile.
 */

/** Cardinal direction a terminal faces; used by routing for the exit angle. */
export type Orientation = 'n' | 's' | 'e' | 'w';

/** Provenance of a library symbol. */
export type LibrarySource =
  | { kind: 'inline' }
  | { kind: 'elmt'; path: string; qetEnglishName?: string };

/** A connection point on a library element, in the element's local frame. */
export interface LibraryTerminal {
  /** Pin name, unique within the element. e.g. "t1", "t_left". */
  id: string;
  x: number;
  y: number;
  orientation: Orientation;
}

/** Stretch behavior, e.g. for busbar segments. */
export interface LibraryStretchable {
  axis: 'x' | 'y';
  minLength: number;
  /** Length at scale 1.0 along the stretch axis. */
  naturalSpan: number;
}

/**
 * State flag declared by a library entry. State lives on `Element.state`
 * (a flat record), not on per-kind shorthand fields, so adding a new kind
 * does not require TypeScript changes.
 *
 * Example: a breaker entry declares `[{ name: 'open', type: 'boolean', default: false }]`,
 * a fuse declares `[{ name: 'blown', type: 'boolean', default: false }]`.
 */
export interface LibraryStateField {
  /** Field key on `Element.state`. */
  name: string;
  type: 'boolean' | 'number' | 'string';
  default?: boolean | number | string;
  /** Optional human label for property panels. */
  label?: string;
}

/**
 * Parameter schema declared by a library entry. Drives the property panel:
 * declared keys render with their human label + unit; any extra keys present
 * on `Element.params` (not in the schema) still render generically so JSON
 * authors can add custom fields without library updates.
 */
export interface LibraryParamField {
  /** Field key on `Element.params`. */
  name: string;
  type: 'boolean' | 'number' | 'string';
  default?: boolean | number | string;
  /** Human label (Chinese in v0). Falls back to `name` when omitted. */
  label?: string;
  /** Display-only unit suffix, e.g. "kV", "MVA", "Ω". */
  unit?: string;
  /** When true, the value (with unit) appears as a structural label on the
   *  canvas next to the symbol — see `AnnotationLayer`. Off by default. */
  showOnCanvas?: boolean;
}

/**
 * Where a structural-label block (element ID + showOnCanvas params) anchors
 * relative to the element's local frame. Used by `AnnotationLayer`.
 */
export interface LibraryLabelAnchor {
  x: number;
  y: number;
  /** SVG `text-anchor`; defaults to `'start'` when omitted. */
  anchor?: 'start' | 'middle' | 'end';
}

/**
 * An alternate DRAWING of a symbol under another graphical standard — same
 * device, same pins, different picture.
 *
 * It carries artwork and frame only. Terminals, params, state and category
 * are deliberately absent and always come from the base entry: a variant that
 * could move a pin would mean flipping the document's standard re-routes the
 * wiring, which is not a rendering change any more. The build script enforces
 * that every variant's frame still contains the base entry's terminals.
 */
export interface LibraryVariant {
  /** SVG viewBox for this drawing. May differ from the base entry's. */
  viewBox: string;
  width: number;
  height: number;
  /** Inner SVG fragment, no `<svg>` wrapper. */
  svg: string;
  /** Pin digits, split out exactly as on the base entry. */
  terminalLabelsSvg?: string;
  /**
   * Label anchor for this drawing. Falls back to the base entry's when
   * omitted — present because a variant with a wider body needs the label
   * pushed clear of it.
   */
  label?: LibraryLabelAnchor;
  /** Where the drawing comes from. Kept so a symbol is always traceable. */
  source: LibraryVariantSource;
}

/** Provenance of a variant drawing — the standard and the clause within it. */
export interface LibraryVariantSource {
  /** e.g. "IEEE Std 315-1975 (ANSI Y32.2-1975)". */
  standard: string;
  /** Clause number within that standard, e.g. "9.4.4". */
  clause: string;
  /** The clause's own caption, verbatim. */
  title?: string;
}

/**
 * One symbol entry in the element library — the contents of a single
 * `src/element-library/<id>.json` file.
 */
export interface LibraryEntry {
  /** Library-scoped ID, kebab-case. Referenced by `Element.kind`. */
  id: string;
  /** Display name (Chinese in v0). */
  name: string;
  /** Palette grouping; consumers group entries by this for the side panel. */
  category: string;
  description?: string;
  /** SVG viewBox. The element's hotspot/origin is at local (0, 0). */
  viewBox: string;
  width: number;
  height: number;
  /** Inner SVG fragment, no `<svg>` wrapper. */
  svg: string;
  /**
   * Terminal-number glyphs (pin digits, e.g. the breaker's "1"/"2") split out
   * of `svg` at build time. Canvas-only wiring affordance: `ElementLayer`
   * renders them in a `.ole-terminal-labels` group that CSS reveals only
   * while the wire/place tool is active or the element is selected. Exports
   * (SVG / PNG / DXF) never include them.
   */
  terminalLabelsSvg?: string;
  terminals: LibraryTerminal[];
  stretchable?: LibraryStretchable;
  /**
   * State fields this kind accepts on `Element.state`. Omitted = no state.
   * Used by the property panel and validators; not enforced at TS compile time.
   */
  state?: LibraryStateField[];
  /**
   * Parameter fields this kind declares on `Element.params`. Used by the
   * property panel to render labeled / unit-suffixed inputs. Not enforced
   * at TS compile time. Extras (keys present on `Element.params` but not in
   * this list) still render generically.
   */
  params?: LibraryParamField[];
  /** Anchor for the structural label block (ID + showOnCanvas params). When
   *  omitted, `AnnotationLayer` falls back to the right edge of the viewBox. */
  label?: LibraryLabelAnchor;
  /**
   * Alternate drawings of this same device under other graphical standards,
   * keyed by `SymbolStandard`. The entry's own artwork is the `iec` drawing,
   * so only non-IEC keys ever appear here. Absent = the symbol is drawn the
   * same way under every standard, which is the case for most of the library
   * (IEEE 315 marks a large share of its symbols as IEC-harmonised).
   */
  variants?: Partial<Record<Exclude<SymbolStandard, 'iec'>, LibraryVariant>>;
  source: LibrarySource;
}
