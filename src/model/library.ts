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
  terminals: LibraryTerminal[];
  stretchable?: LibraryStretchable;
  /**
   * State fields this kind accepts on `Element.state`. Omitted = no state.
   * Used by the property panel and validators; not enforced at TS compile time.
   */
  state?: LibraryStateField[];
  source: LibrarySource;
}
