/**
 * Busbar trunking (busduct / busway) — IEC 60617-11-17, requested as
 * "Busduct should be added".
 *
 * These pin the two decisions that are not obvious from the JSON: a busduct
 * run is a two-port ELEMENT (not a `Bus`, which is a hyperedge many devices
 * tap), and the tap-off drops BELOW the horizontal run, because that is the
 * side loads hang on.
 */

import { describe, expect, it } from 'vitest';
import { libraryById } from '../../src/element-library';

const straight = libraryById['busduct'];
const tap = libraryById['busduct-tap'];

const term = (entry: typeof straight, id: string) =>
  entry.terminals.find((t) => t.id === id);

describe('busduct', () => {
  it('is a two-port series element on the horizontal run axis', () => {
    expect(term(straight, 't_left')).toMatchObject({ y: 0, orientation: 'w' });
    expect(term(straight, 't_right')).toMatchObject({ y: 0, orientation: 'e' });
    expect(straight.terminals).toHaveLength(2);
    // Not `stretchable`: unlike `busbar` it is an element in series, not a
    // bus whose span the user drags out.
    expect(straight.stretchable).toBeUndefined();
  });

  it('sits with the other bus/wiring symbols in the palette', () => {
    expect(straight.category).toBe('busbar');
    expect(tap.category).toBe('busbar');
  });

  it('comes from the standard, not from a hand-drawn shape', () => {
    for (const e of [straight, tap]) {
      expect(e.source.kind).toBe('elmt');
      expect(e.source).toHaveProperty('path', expect.stringContaining('en_60617_11_17'));
    }
  });

  it('is centred on its origin so canvas rotation pivots inside the symbol', () => {
    for (const e of [straight, tap]) {
      const [x, , w] = e.viewBox.split(/\s+/).map(Number);
      expect(x + w / 2).toBe(0);
    }
  });
});

describe('busduct-tap', () => {
  it('drops its tap-off below the run, where the loads hang', () => {
    const t = term(tap, 't_tap');
    expect(t).toBeDefined();
    expect(t!.x).toBe(0);
    expect(t!.y).toBeGreaterThan(0);
    expect(t!.orientation).toBe('s');
  });

  it('keeps both run ends so it can be spliced into a busway run', () => {
    expect(term(tap, 't_left')?.orientation).toBe('w');
    expect(term(tap, 't_right')?.orientation).toBe('e');
    expect(tap.terminals).toHaveLength(3);
  });
});
