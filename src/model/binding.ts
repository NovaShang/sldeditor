/**
 * Runtime data binding — the metadata that turns a static drawing into a live
 * one. Everything here is *declarative* and serialises inside `DiagramFile`
 * (`tags` / `bindings`): the editor round-trips it untouched, the viewer
 * evaluates it against a host-provided `TagSource`.
 *
 * Design notes (see docs/binding-and-viewer-api.md §1):
 *   - A tag `path` is an opaque string; the HOST owns the namespace. The
 *     library never insists it line up with element ids.
 *   - `tags` is an optional index for authoring UIs. A binding may reference a
 *     path that is not declared there — resolution is the host's problem.
 *   - `Mapping` is JSON, not a script engine. Only `pass` and `discrete` exist
 *     today; unknown `type`s are skipped by the resolver with a warning so a
 *     file written by a newer version still opens.
 */

import type { ElementId } from './types';

export type TagType = 'bool' | 'int' | 'float' | 'string' | 'enum';

/** Declared data point. Purely descriptive — see file header. */
export interface Tag {
  path: string;
  type: TagType;
  /** Display unit, appended after a `value` readout ("A", "kV", "°C"). */
  unit?: string;
  /** Legal values when `type === 'enum'`. */
  enum?: string[];
  description?: string;
}

/** JSON-friendly scalar a tag can carry. */
export type TagPrimitive = string | number | boolean | null;

export type TagQuality = 'good' | 'bad' | 'stale';

/**
 * One sample of a tag. `q` absent means `good`; `t` is a millisecond
 * timestamp the host may attach (the library only carries it through).
 */
export interface TagValue {
  v: unknown;
  q?: TagQuality;
  t?: number;
}

/**
 * The element properties a binding can drive.
 *   - `visible`     boolean; `false` hides the symbol and its label.
 *   - `label.text`  string; replaces the structural label block.
 *   - `alarm`       `AlarmLevel`; recolours the symbol and its wires.
 *   - `value`       any; rendered as a small readout beside the symbol.
 *   - `badge`       string; small pill at the symbol's top-right corner.
 *   - `state.<k>`   reserved for library state fields (carried, not drawn).
 */
export type BindableProp =
  | 'visible'
  | 'label.text'
  | 'alarm'
  | 'value'
  | 'badge'
  | `state.${string}`;

export type AlarmLevel = 'none' | 'warn' | 'alarm' | 'fault';

/** Element (or bus) property ← tag, through an optional mapping. */
export interface Binding {
  /** Device id or bus id. */
  target: ElementId;
  prop: BindableProp;
  /** Tag path — host-defined namespace. */
  tag: string;
  /** Absent = `{ type: 'pass' }`. */
  mapping?: Mapping;
}

export type Mapping =
  | { type: 'pass' }
  | {
      type: 'discrete';
      cases: { when: TagPrimitive; out: unknown }[];
      /** Emitted when no case matches. Absent = the prop is left unset. */
      default?: unknown;
    };
