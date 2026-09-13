/**
 * `TagSource` — the one interface a host implements to feed live data into
 * `<OneLineViewer>`. The library ships no drivers (Modbus / OPC UA / MQTT are
 * the host's business); it only ever calls these two methods.
 *
 * `createStaticTagSource` is the in-memory reference implementation: good
 * enough for demos, tests and hosts that already hold a snapshot and just
 * push updates into it.
 */

import type { TagPrimitive, TagValue } from '../model';

export interface TagSource {
  /** Synchronous read. `undefined` = the source has no such tag (yet). */
  get(path: string): TagValue | undefined;
  /**
   * Subscribe to a set of paths. `onChange` receives only the tags that
   * changed, keyed by path. Returns the unsubscribe function.
   */
  subscribe(
    paths: string[],
    onChange: (changes: Record<string, TagValue>) => void,
  ): () => void;
}

export interface StaticTagSource extends TagSource {
  set(path: string, value: TagValue | TagPrimitive): void;
  setMany(values: Record<string, TagValue | TagPrimitive>): void;
}

/** Accept either a bare primitive or a full sample; always store a sample. */
export function toTagValue(value: TagValue | TagPrimitive): TagValue {
  if (value !== null && typeof value === 'object' && 'v' in value) return value;
  return { v: value };
}

/**
 * In-memory tag store. `set` / `setMany` notify every subscriber whose path
 * set intersects the change — one callback per subscriber per call, so a
 * `setMany` of twenty tags is one notification, not twenty.
 */
export function createStaticTagSource(
  initial: Record<string, TagValue | TagPrimitive> = {},
): StaticTagSource {
  const values = new Map<string, TagValue>();
  for (const [path, v] of Object.entries(initial)) values.set(path, toTagValue(v));

  interface Sub {
    paths: Set<string>;
    onChange: (changes: Record<string, TagValue>) => void;
  }
  const subs = new Set<Sub>();

  const notify = (changed: Record<string, TagValue>) => {
    for (const sub of subs) {
      let hit: Record<string, TagValue> | null = null;
      for (const path in changed) {
        if (!sub.paths.has(path)) continue;
        (hit ??= {})[path] = changed[path];
      }
      if (hit) sub.onChange(hit);
    }
  };

  return {
    get: (path) => values.get(path),
    subscribe(paths, onChange) {
      const sub: Sub = { paths: new Set(paths), onChange };
      subs.add(sub);
      return () => {
        subs.delete(sub);
      };
    },
    set(path, value) {
      const tv = toTagValue(value);
      values.set(path, tv);
      notify({ [path]: tv });
    },
    setMany(next) {
      const changed: Record<string, TagValue> = {};
      for (const [path, v] of Object.entries(next)) {
        const tv = toTagValue(v);
        values.set(path, tv);
        changed[path] = tv;
      }
      notify(changed);
    },
  };
}
