/**
 * `createStaticTagSource`: the reference `TagSource`. Subscribers only hear
 * about the paths they asked for, and a `setMany` is one notification.
 */

import { describe, expect, it, vi } from 'vitest';
import { createStaticTagSource, toTagValue } from '../../src/runtime/tag-source';

describe('toTagValue', () => {
  it('wraps primitives and passes samples through', () => {
    expect(toTagValue(3)).toEqual({ v: 3 });
    expect(toTagValue(null)).toEqual({ v: null });
    expect(toTagValue(false)).toEqual({ v: false });
    const s = { v: 1, q: 'stale' as const, t: 5 };
    expect(toTagValue(s)).toBe(s);
  });
});

describe('createStaticTagSource', () => {
  it('seeds from the initial record', () => {
    const src = createStaticTagSource({ a: 1, b: { v: 'x', q: 'bad' } });
    expect(src.get('a')).toEqual({ v: 1 });
    expect(src.get('b')).toEqual({ v: 'x', q: 'bad' });
    expect(src.get('missing')).toBeUndefined();
  });

  it('notifies subscribers of their own paths only', () => {
    const src = createStaticTagSource();
    const onA = vi.fn();
    const onB = vi.fn();
    src.subscribe(['a'], onA);
    src.subscribe(['b'], onB);
    src.set('a', 1);
    expect(onA).toHaveBeenCalledWith({ a: { v: 1 } });
    expect(onB).not.toHaveBeenCalled();
  });

  it('batches setMany into one callback and unsubscribes cleanly', () => {
    const src = createStaticTagSource();
    const on = vi.fn();
    const off = src.subscribe(['a', 'b'], on);
    src.setMany({ a: 1, b: 2, c: 3 });
    expect(on).toHaveBeenCalledTimes(1);
    expect(on).toHaveBeenCalledWith({ a: { v: 1 }, b: { v: 2 } });
    off();
    src.set('a', 9);
    expect(on).toHaveBeenCalledTimes(1);
    expect(src.get('a')).toEqual({ v: 9 });
  });
});
