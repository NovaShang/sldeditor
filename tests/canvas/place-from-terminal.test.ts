/**
 * Placing a device from a terminal, and free placement next to one.
 *
 * Single-pole chaining was already right; these pin down the multi-pole
 * cases a hands-on circuit test found wrong: the new device's middle pole
 * connected because it sat nearest the cursor, one conductor was drawn where
 * three were meant, a contact tapped onto the end of a horizontal run stood
 * on its head, and a click-placed contactor landed one pole off the breaker
 * above it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The persist middleware writes on every `set` and the suite runs in plain
// node (no jsdom), so install a memory localStorage before the store module
// is evaluated. `vi.hoisted` runs above the imports.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() {
      return mem.size;
    },
    key: (i: number) => [...mem.keys()][i] ?? null,
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
    removeItem: (k: string) => {
      mem.delete(k);
    },
    clear: () => {
      mem.clear();
    },
  } as Storage;
});

import { dropElement, dropElementFromTerminal } from '../../src/canvas/drop-on-bus';
import { useEditorStore } from '../../src/store';
import type { DiagramFile, WireEnd } from '../../src/model';

const circuit = (d: Partial<DiagramFile>): DiagramFile => ({
  version: '1',
  meta: { diagramType: 'circuit' },
  elements: [],
  wires: [],
  ...d,
});

/** breaker-3p at (100,100): poles at x 80/100/120, outgoing 2/4/6 at y 120. */
function withBreaker(extra: Partial<DiagramFile> = {}) {
  useEditorStore.getState().setDiagram(
    circuit({
      elements: [{ id: 'Q1', kind: 'breaker-3p' }],
      layout: { Q1: { at: [100, 100] } },
      ...extra,
    }),
  );
}

function newOf(kind: string) {
  const d = useEditorStore.getState().diagram;
  const el = d.elements.find((e) => e.kind === kind);
  if (!el) throw new Error(`no ${kind}`);
  return { id: el.id, at: d.layout?.[el.id]?.at };
}

/** Wires as sorted "a-b" pairs, for order-free comparison. */
function wirePairs(): string[] {
  return (useEditorStore.getState().diagram.wires ?? [])
    .map((w) => [...w.ends].sort().join('-'))
    .sort();
}

const pair = (a: WireEnd, b: WireEnd) => [a, b].sort().join('-');

describe('place from a multi-pole terminal', () => {
  beforeEach(() => withBreaker());

  it('drags pole for pole: breaker 2 feeds contactor 1, and all three phases are wired straight', () => {
    const before = useEditorStore.getState().past.length;
    // Cursor a few units off the column, as a hand would leave it.
    dropElementFromTerminal('contactor-3p', 'Q1.t2', [84, 203]);
    const k = newOf('contactor-3p');
    // Pin 1 (local −20,−20) exactly below breaker pin 2 at x 80.
    expect(k.at).toEqual([100, 220]);
    expect(wirePairs()).toEqual(
      [
        pair('Q1.t2', `${k.id}.t1`),
        pair('Q1.t4', `${k.id}.t3`),
        pair('Q1.t6', `${k.id}.t5`),
      ].sort(),
    );
    // Element + three conductors = one undo step.
    expect(useEditorStore.getState().past.length).toBe(before + 1);
  });

  it('a tap on any outgoing pin lines the device up under the whole breaker', () => {
    dropElementFromTerminal('contactor-3p', 'Q1.t4', [100, 120]);
    const k = newOf('contactor-3p');
    // Pin 3 (the middle pole) on breaker pin 4 — not shifted by a pole.
    expect(k.at).toEqual([100, 140]);
    expect(wirePairs()).toHaveLength(3);
    expect(wirePairs()).toContain(pair('Q1.t4', `${k.id}.t3`));
  });

  it('wires a motor U/V/W from an overload relay', () => {
    withBreaker({
      elements: [{ id: 'F1', kind: 'overload-relay-3p' }],
      layout: { F1: { at: [100, 100] } },
    });
    dropElementFromTerminal('motor-3ph', 'F1.t2', [80, 200]);
    const m = newOf('motor-3ph');
    expect(wirePairs()).toEqual(
      [pair('F1.t2', `${m.id}.t_u`), pair('F1.t4', `${m.id}.t_v`), pair('F1.t6', `${m.id}.t_w`)].sort(),
    );
  });

  it('leaves a pole that is already wired alone', () => {
    withBreaker({
      junctions: [{ id: 'J1', layout: { at: [200, 200] } }],
      wires: [{ id: 'w0', ends: ['Q1.t6', 'J1'] }],
    });
    dropElementFromTerminal('contactor-3p', 'Q1.t2', [80, 200]);
    const k = newOf('contactor-3p');
    const pairs = wirePairs();
    expect(pairs).toContain(pair('Q1.t2', `${k.id}.t1`));
    expect(pairs).toContain(pair('Q1.t4', `${k.id}.t3`));
    expect(pairs).not.toContain(pair('Q1.t6', `${k.id}.t5`));
  });

  it('drives a single-pole device from one pole with one conductor', () => {
    dropElementFromTerminal('fuse', 'Q1.t4', [100, 200]);
    expect(wirePairs()).toHaveLength(1);
    expect(wirePairs()[0]).toContain('Q1.t4');
  });
});

describe('place from a single-pole terminal (unchanged)', () => {
  it('drag: the connecting pin lands on the snapped cursor, one conductor', () => {
    useEditorStore.getState().setDiagram(
      circuit({
        elements: [{ id: 'S1', kind: 'make-contact' }],
        layout: { S1: { at: [100, 100] } },
      }),
    );
    // make-contact t2 (14) at (100,120); relay-coil A1 is local (0,−20).
    dropElementFromTerminal('relay-coil', 'S1.t2', [113, 204]);
    const k = newOf('relay-coil');
    expect(k.at).toEqual([110, 220]);
    expect(wirePairs()).toEqual([pair('S1.t2', `${k.id}.t1`)]);
  });
});

describe('place from a junction', () => {
  it('a tap at the end of a horizontal run hangs the contact downward', () => {
    useEditorStore.getState().setDiagram(
      circuit({
        junctions: [
          { id: 'J1', layout: { at: [0, 100] } },
          { id: 'J2', layout: { at: [200, 100] } },
        ],
        wires: [{ id: 'w0', ends: ['J1', 'J2'] }],
      }),
    );
    dropElementFromTerminal('make-contact', 'J2', [200, 100]);
    const k = newOf('make-contact');
    // Pin 13 (local 0,−40, facing up) on the junction; body below it.
    expect(k.at).toEqual([200, 140]);
    expect(wirePairs()).toContain(pair('J2', `${k.id}.t1`));
  });

  it('a tap below a vertical conductor continues it downward', () => {
    useEditorStore.getState().setDiagram(
      circuit({
        junctions: [
          { id: 'J1', layout: { at: [100, 0] } },
          { id: 'J2', layout: { at: [100, 100] } },
        ],
        wires: [{ id: 'w0', ends: ['J1', 'J2'] }],
      }),
    );
    dropElementFromTerminal('relay-coil', 'J2', [100, 100]);
    expect(wirePairs()).toContain(pair('J2', `${newOf('relay-coil').id}.t1`));
  });

  it('a sideways drag of a vertical device still picks a pin that faces the junction', () => {
    useEditorStore.getState().setDiagram(
      circuit({ junctions: [{ id: 'J1', layout: { at: [0, 0] } }] }),
    );
    dropElementFromTerminal('relay-coil', 'J1', [100, 20]);
    // Cursor right and below: hang below the cursor via A1.
    expect(wirePairs()).toContain(pair('J1', `${newOf('relay-coil').id}.t1`));
  });
});

describe('free placement lines a multi-pole device up with the poles above', () => {
  beforeEach(() => withBreaker());

  it('aimed by its middle, a contactor snaps pole for pole under the breaker', () => {
    // The cursor carries pole 1, so a click under the breaker's middle used
    // to put pole 1 under pole 2.
    dropElement('contactor-3p', [100, 200]);
    expect(newOf('contactor-3p').at).toEqual([100, 220]);
  });

  it('half a pole off still snaps', () => {
    dropElement('contactor-3p', [92, 200]);
    expect(newOf('contactor-3p').at).toEqual([100, 220]);
  });

  it('far to the side it stays where it was put', () => {
    dropElement('contactor-3p', [300, 200]);
    expect(newOf('contactor-3p').at).toEqual([320, 220]);
  });

  it('single-pole devices place on the cursor as before', () => {
    dropElement('relay-coil', [100, 200]);
    expect(newOf('relay-coil').at).toEqual([100, 220]);
  });
});
