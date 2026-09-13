/**
 * Pure binding layer: `resolveBindings` + the authoring helpers.
 *
 * What these pin down is the contract a host builds on: `pass` is the default
 * mapping, `discrete` falls through to `default`, an unknown mapping type is
 * skipped with a warning rather than thrown, `bad` data is flagged but never
 * applied, and the helpers return new files without touching the input.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bindingsOf,
  removeBindings,
  resolveBindings,
  upsertBinding,
} from '../../src/runtime/bindings';
import { createStaticTagSource } from '../../src/runtime/tag-source';
import type { Binding, DiagramFile, Mapping } from '../../src/model';

const HEALTH: Mapping = {
  type: 'discrete',
  cases: [
    { when: 'normal', out: 'none' },
    { when: 'attention', out: 'warn' },
    { when: 'abnormal', out: 'alarm' },
    { when: 'critical', out: 'fault' },
  ],
  default: 'none',
};

function diagram(bindings: Binding[]): DiagramFile {
  return {
    version: '1',
    elements: [
      { id: 'QF1', kind: 'breaker' },
      { id: 'QF2', kind: 'breaker' },
    ],
    buses: [{ id: 'B1' }],
    bindings,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveBindings', () => {
  it('pass (default mapping) copies the tag value onto the prop', () => {
    const d = diagram([
      { target: 'QF1', prop: 'value', tag: 'QF1/I' },
      { target: 'QF1', prop: 'badge', tag: 'QF1/badge', mapping: { type: 'pass' } },
      { target: 'QF1', prop: 'label.text', tag: 'QF1/name' },
      { target: 'QF1', prop: 'visible', tag: 'QF1/vis' },
      { target: 'QF1', prop: 'state.open', tag: 'QF1/open' },
    ]);
    const tags = createStaticTagSource({
      'QF1/I': 12.5,
      'QF1/badge': '过热',
      'QF1/name': 'QF1 · 101',
      'QF1/vis': 0,
      'QF1/open': true,
    });
    const r = resolveBindings(d, tags);
    expect(r.QF1).toEqual({
      quality: 'good',
      value: 12.5,
      badge: '过热',
      labelText: 'QF1 · 101',
      visible: false,
      state: { open: true },
    });
  });

  it('discrete maps a matching case and falls back to default', () => {
    const d = diagram([
      { target: 'QF1', prop: 'alarm', tag: 'QF1/h', mapping: HEALTH },
      { target: 'QF2', prop: 'alarm', tag: 'QF2/h', mapping: HEALTH },
    ]);
    const tags = createStaticTagSource({ 'QF1/h': 'critical', 'QF2/h': 'whatever' });
    const r = resolveBindings(d, tags);
    expect(r.QF1.alarm).toBe('fault');
    expect(r.QF2.alarm).toBe('none');
  });

  it('discrete without default leaves the prop unset on a miss', () => {
    const noDefault: Mapping = { type: 'discrete', cases: [{ when: 1, out: 'warn' }] };
    const d = diagram([{ target: 'QF1', prop: 'alarm', tag: 't', mapping: noDefault }]);
    const r = resolveBindings(d, createStaticTagSource({ t: 2 }));
    expect(r.QF1).toEqual({ quality: 'good' });
  });

  it('discrete matches strictly (no "1" == 1 coercion)', () => {
    const m: Mapping = { type: 'discrete', cases: [{ when: 1, out: 'X' }], default: 'D' };
    const d = diagram([{ target: 'QF1', prop: 'badge', tag: 't', mapping: m }]);
    expect(resolveBindings(d, createStaticTagSource({ t: '1' })).QF1.badge).toBe('D');
    expect(resolveBindings(d, createStaticTagSource({ t: 1 })).QF1.badge).toBe('X');
  });

  it('skips an unknown mapping type with a warning, keeps the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = diagram([
      {
        target: 'QF1',
        prop: 'value',
        tag: 't',
        mapping: { type: 'linear-xyz' } as unknown as Mapping,
      },
      { target: 'QF1', prop: 'badge', tag: 'b' },
    ]);
    const r = resolveBindings(d, createStaticTagSource({ t: 5, b: 'ok' }));
    expect(r.QF1.value).toBeUndefined();
    expect(r.QF1.badge).toBe('ok');
    expect(r.QF1.quality).toBe('good');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/linear-xyz/);
    // Warned once per binding, not once per resolve.
    resolveBindings(d, createStaticTagSource({ t: 6 }));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('ignores an alarm output that is not a level', () => {
    const d = diagram([{ target: 'QF1', prop: 'alarm', tag: 't' }]);
    const r = resolveBindings(d, createStaticTagSource({ t: 'purple' }));
    expect(r.QF1.alarm).toBeUndefined();
  });

  describe('quality propagation', () => {
    it('is the worst of the bound tags', () => {
      const d = diagram([
        { target: 'QF1', prop: 'value', tag: 'a' },
        { target: 'QF1', prop: 'badge', tag: 'b' },
        { target: 'QF2', prop: 'value', tag: 'c' },
        { target: 'QF2', prop: 'badge', tag: 'd' },
      ]);
      const tags = createStaticTagSource({
        a: { v: 1 },
        b: { v: 'x', q: 'stale' },
        c: { v: 1, q: 'stale' },
        d: { v: 'x', q: 'bad' },
      });
      const r = resolveBindings(d, tags);
      expect(r.QF1.quality).toBe('stale');
      expect(r.QF2.quality).toBe('bad');
    });

    it('applies stale samples but not bad ones', () => {
      const d = diagram([
        { target: 'QF1', prop: 'value', tag: 'a' },
        { target: 'QF1', prop: 'badge', tag: 'b' },
      ]);
      const tags = createStaticTagSource({
        a: { v: 42, q: 'stale' },
        b: { v: 'nope', q: 'bad' },
      });
      const r = resolveBindings(d, tags);
      expect(r.QF1.value).toBe(42);
      expect(r.QF1.badge).toBeUndefined();
      expect(r.QF1.quality).toBe('bad');
    });

    it('a tag the source does not know contributes nothing', () => {
      const d = diagram([
        { target: 'QF1', prop: 'value', tag: 'known' },
        { target: 'QF1', prop: 'badge', tag: 'missing' },
      ]);
      const r = resolveBindings(d, createStaticTagSource({ known: 7 }));
      expect(r.QF1).toEqual({ quality: 'good', value: 7 });
    });
  });

  it('unbound: bound but no tag has a value yet → quality "unbound", no props', () => {
    const d = diagram([{ target: 'QF1', prop: 'alarm', tag: 'nothing', mapping: HEALTH }]);
    const r = resolveBindings(d, createStaticTagSource());
    expect(r.QF1).toEqual({ quality: 'unbound' });
    // An element with no bindings is absent from the result altogether.
    expect(r.QF2).toBeUndefined();
  });

  it('a diagram without bindings resolves to an empty record', () => {
    expect(resolveBindings({ version: '1', elements: [] }, createStaticTagSource())).toEqual({});
  });

  it('a bus is a legal target', () => {
    const d = diagram([{ target: 'B1', prop: 'value', tag: 'U' }]);
    expect(resolveBindings(d, createStaticTagSource({ U: 10.5 })).B1.value).toBe(10.5);
  });
});

describe('bindingsOf', () => {
  it('returns the target’s bindings in file order', () => {
    const d = diagram([
      { target: 'QF2', prop: 'value', tag: 'x' },
      { target: 'QF1', prop: 'badge', tag: 'b' },
      { target: 'QF1', prop: 'alarm', tag: 'a' },
    ]);
    expect(bindingsOf(d, 'QF1').map((b) => b.prop)).toEqual(['badge', 'alarm']);
    expect(bindingsOf(d, 'nope')).toEqual([]);
    expect(bindingsOf({ version: '1', elements: [] }, 'QF1')).toEqual([]);
  });
});

describe('upsertBinding', () => {
  it('appends a new binding and does not mutate the input', () => {
    const d = diagram([]);
    const next = upsertBinding(d, { target: 'QF1', prop: 'value', tag: 'I' });
    expect(next.bindings).toEqual([{ target: 'QF1', prop: 'value', tag: 'I' }]);
    expect(d.bindings).toEqual([]);
    expect(next).not.toBe(d);
  });

  it('starts the list on a file that has none', () => {
    const d: DiagramFile = { version: '1', elements: [{ id: 'QF1', kind: 'breaker' }] };
    const next = upsertBinding(d, { target: 'QF1', prop: 'value', tag: 'I' });
    expect(next.bindings).toHaveLength(1);
    expect(d.bindings).toBeUndefined();
  });

  it('overwrites the same target + prop in place, leaving others alone', () => {
    const d = diagram([
      { target: 'QF1', prop: 'alarm', tag: 'old', mapping: HEALTH },
      { target: 'QF1', prop: 'value', tag: 'I' },
      { target: 'QF2', prop: 'alarm', tag: 'other' },
    ]);
    const next = upsertBinding(d, { target: 'QF1', prop: 'alarm', tag: 'new' });
    expect(next.bindings).toEqual([
      { target: 'QF1', prop: 'alarm', tag: 'new' },
      { target: 'QF1', prop: 'value', tag: 'I' },
      { target: 'QF2', prop: 'alarm', tag: 'other' },
    ]);
  });
});

describe('removeBindings', () => {
  const d = diagram([
    { target: 'QF1', prop: 'alarm', tag: 'a' },
    { target: 'QF1', prop: 'value', tag: 'v' },
    { target: 'QF2', prop: 'alarm', tag: 'b' },
  ]);

  it('removes one prop', () => {
    const next = removeBindings(d, 'QF1', 'alarm');
    expect(next.bindings).toEqual([
      { target: 'QF1', prop: 'value', tag: 'v' },
      { target: 'QF2', prop: 'alarm', tag: 'b' },
    ]);
    expect(d.bindings).toHaveLength(3);
  });

  it('removes every binding of a target', () => {
    const next = removeBindings(d, 'QF1');
    expect(next.bindings).toEqual([{ target: 'QF2', prop: 'alarm', tag: 'b' }]);
  });

  it('drops the field when the list empties', () => {
    const next = removeBindings(removeBindings(d, 'QF1'), 'QF2');
    expect('bindings' in next).toBe(false);
  });

  it('returns the same object when nothing matches', () => {
    expect(removeBindings(d, 'nope')).toBe(d);
    const bare: DiagramFile = { version: '1', elements: [] };
    expect(removeBindings(bare, 'QF1')).toBe(bare);
  });
});
