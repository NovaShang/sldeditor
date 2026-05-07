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
  /**
   * Parameter fields this kind declares on `Element.params`. Used by the
   * property panel to render labeled / unit-suffixed inputs. Not enforced
   * at TS compile time. Extras (keys present on `Element.params` but not in
   * this list) still render generically.
   */
  params?: LibraryParamField[];
  source: LibrarySource;
}
