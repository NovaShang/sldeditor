/**
 * Drop a symbol on a wire → it goes in line; delete it → the wire closes.
 * Plus the two rail gestures of circuit diagrams: a symbol placed under a
 * rail hangs from it, and a branch pulled out of a rail keeps its tap where
 * the rail was pressed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { dropElement } from '../../src/canvas/drop-on-bus';
import { applyInsert, planInsertOnWire } from '../../src/canvas/insert-on-wire';
import { libraryById } from '../../src/element-library';
import { useEditorStore } from '../../src/store';
import type { DiagramFile, Wire } from '../../src/model';

const doc = (d: Partial<DiagramFile>, type: 'circuit' | 'sld' = 'circuit'): DiagramFile => ({
  version: '1',
  ...(type === 'circuit' ? { meta: { diagramType: 'circuit' } } : {}),
  elements: [],
  wires: [],
  ...d,
});

const S = () => useEditorStore.getState();
const pairs = () =>
  (S().diagram.wires ?? []).map((w) => [...w.ends].sort().join('-')).sort();
const pair = (a: string, b: string) => [a, b].sort().join('-');
function newOf(kind: string) {
  const el = S().diagram.elements.find((e) => e.kind === kind && !['Q1', 'Q2'].includes(e.id));
  if (!el) throw new Error(`no ${kind}`);
  return { id: el.id, place: S().diagram.layout?.[el.id] };
}

/** Breakers Q1 at (100,0) and Q2 at (100,200), Q1.t2 (y 20) wired to Q2.t1 (y 180). */
function vertical(type: 'circuit' | 'sld' = 'circuit', wire: Partial<Wire> = {}) {
  S().setDiagram(
    doc(
      {
        elements: [
          { id: 'Q1', kind: 'breaker' },
          { id: 'Q2', kind: 'breaker' },
        ],
        layout: { Q1: { at: [100, 0] }, Q2: { at: [100, 200] } },
        wires: [{ id: 'w1', ends: ['Q1.t2', 'Q2.t1'], label: 'L1', color: 'brown', ...wire }],
      },
      type,
    ),
  );
}

describe('drop on a wire', () => {
  beforeEach(() => vertical());

  it('cuts a vertical run and puts a contact in line, in one undo step', () => {
    const before = S().past.length;
    dropElement('make-contact', [103, 100]);
    expect(S().past.length).toBe(before + 1);
    const k = newOf('make-contact');
    // Pins (local y -40 / 20) centred on the cursor, exactly on the wire's x.
    expect(k.place).toEqual({ at: [100, 110] });
    expect(pairs()).toEqual([pair('Q1.t2', `${k.id}.t1`), pair(`${k.id}.t2`, 'Q2.t1')].sort());
    // Both halves are still the L1 conductor.
    for (const w of S().diagram.wires ?? []) {
      expect(w.label).toBe('L1');
      expect(w.color).toBe('brown');
      expect(w.path).toBeUndefined();
    }
  });

  it('works on single-line diagrams too', () => {
    vertical('sld');
    dropElement('fuse', [100, 100]);
    const f = newOf('fuse');
    expect(pairs()).toEqual([pair('Q1.t2', `${f.id}.t1`), pair(`${f.id}.t2`, 'Q2.t1')].sort());
  });

  it('slides along the run instead of refusing a drop that overhangs its end', () => {
    dropElement('make-contact', [100, 30]);
    const k = newOf('make-contact');
    const top = (k.place?.at[1] ?? 0) - 40;
    expect(top).toBeGreaterThan(20);
    expect(pairs()).toContain(pair('Q1.t2', `${k.id}.t1`));
  });

  it('does not insert when the run is shorter than the symbol', () => {
    S().setDiagram(
      doc({
        elements: [
          { id: 'Q1', kind: 'breaker' },
          { id: 'Q2', kind: 'breaker' },
        ],
        layout: { Q1: { at: [100, 0] }, Q2: { at: [100, 70] } },
        wires: [{ id: 'w1', ends: ['Q1.t2', 'Q2.t1'] }],
      }),
    );
    dropElement('make-contact', [100, 35]);
    expect(pairs()).toEqual([pair('Q1.t2', 'Q2.t1')]);
  });

  it('ignores a drop away from any wire', () => {
    dropElement('make-contact', [300, 100]);
    expect(pairs()).toEqual([pair('Q1.t2', 'Q2.t1')]);
  });

  it('turns the symbol along a horizontal run, first pin toward the wire start', () => {
    S().setDiagram(
      doc({
        junctions: [
          { id: 'J1', layout: { at: [0, 100] } },
          { id: 'J2', layout: { at: [300, 100] } },
        ],
        wires: [{ id: 'w1', ends: ['J2', 'J1'] }],
      }),
    );
    const plan = planInsertOnWire(libraryById['make-contact'], [150, 104], 10);
    expect(plan?.placement.rot).toBe(270);
    dropElement('make-contact', [150, 104]);
    const k = newOf('make-contact');
    expect(k.place?.rot).toBe(270);
    // rot 270: local (0,-40) → (-40,0), (0,20) → (20,0); both on y 100.
    expect(k.place?.at[1]).toBe(100);
    // The wire runs J2 (right) → J1 (left): the right-hand pin (t2) meets J2.
    expect(pairs()).toEqual([pair('J2', `${k.id}.t2`), pair(`${k.id}.t1`, 'J1')].sort());
  });

  it('puts a three-pole contactor into all three phase conductors', () => {
    const elements = [
      { id: 'Q1', kind: 'breaker-3p' },
      { id: 'M1', kind: 'breaker-3p' },
    ];
    // Q1 outgoing 2/4/6 at y 20 (x 80/100/120); M1 incoming 1/3/5 at y 280.
    S().setDiagram(
      doc({
        elements,
        layout: { Q1: { at: [100, 0] }, M1: { at: [100, 300] } },
        wires: [
          { id: 'a', ends: ['Q1.t2', 'M1.t1'] },
          { id: 'b', ends: ['Q1.t4', 'M1.t3'] },
          { id: 'c', ends: ['Q1.t6', 'M1.t5'] },
        ],
      }),
    );
    // Aimed at the right-hand phase: still lines up pole for pole.
    dropElement('contactor-3p', [121, 150]);
    const k = newOf('contactor-3p');
    expect(k.place?.at[0]).toBe(100);
    expect(pairs()).toEqual(
      [
        pair('Q1.t2', `${k.id}.t1`),
        pair(`${k.id}.t2`, 'M1.t1'),
        pair('Q1.t4', `${k.id}.t3`),
        pair(`${k.id}.t4`, 'M1.t3'),
        pair('Q1.t6', `${k.id}.t5`),
        pair(`${k.id}.t6`, 'M1.t5'),
      ].sort(),
    );
  });

  it('keeps a hand-drawn route, cut at the pins', () => {
    S().setDiagram(
      doc({
        elements: [
          { id: 'Q1', kind: 'breaker' },
          { id: 'Q2', kind: 'breaker' },
        ],
        layout: { Q1: { at: [100, 0] }, Q2: { at: [300, 300] } },
        wires: [
          {
            id: 'w1',
            ends: ['Q1.t2', 'Q2.t1'],
            path: [
              [100, 20],
              [100, 200],
              [300, 200],
              [300, 280],
            ],
          },
        ],
      }),
    );
    dropElement('make-contact', [100, 100]);
    const k = newOf('make-contact');
    const wires = S().diagram.wires ?? [];
    const upper = wires.find((w) => w.ends.includes('Q1.t2'));
    const lower = wires.find((w) => w.ends.includes('Q2.t1'));
    expect(upper?.path).toBeUndefined(); // a straight stub: the router's own line
    expect(lower?.ends).toEqual([`${k.id}.t2`, 'Q2.t1']);
    expect(lower?.path).toEqual([
      [100, 130],
      [100, 200],
      [300, 200],
      [300, 280],
    ]);
  });

  it('previews exactly what it commits', () => {
    const plan = planInsertOnWire(libraryById['make-contact'], [103, 100], 10);
    expect(plan?.hosts).toHaveLength(1);
    expect(plan?.cuts[0].pinToStart.at).toEqual([100, 70]);
    expect(plan?.cuts[0].pinToEnd.at).toEqual([100, 130]);
  });

  it('puts an existing loose device in line (the drag path)', () => {
    S().setDiagram(
      doc({
        elements: [
          { id: 'Q1', kind: 'breaker' },
          { id: 'Q2', kind: 'breaker' },
          { id: 'K1', kind: 'make-contact' },
        ],
        layout: { Q1: { at: [100, 0] }, Q2: { at: [100, 200] }, K1: { at: [400, 100] } },
        wires: [{ id: 'w1', ends: ['Q1.t2', 'Q2.t1'] }],
      }),
    );
    const plan = planInsertOnWire(libraryById['make-contact'], [100, 100], 10)!;
    const m = S().internal;
    S().dispatch((d) => applyInsert(d, m, 'K1', plan));
    expect(S().diagram.layout?.K1).toEqual({ at: [100, 110] });
    expect(pairs()).toEqual([pair('Q1.t2', 'K1.t1'), pair('K1.t2', 'Q2.t1')].sort());
  });
});

describe('delete heals the conductor (circuit diagrams)', () => {
  it('closes the wire back up with its label and colour', () => {
    vertical();
    dropElement('make-contact', [100, 100]);
    const k = newOf('make-contact');
    S().setSelection([k.id]);
    S().deleteSelection();
    expect(pairs()).toEqual([pair('Q1.t2', 'Q2.t1')]);
    const w = S().diagram.wires?.[0];
    expect(w?.label).toBe('L1');
    expect(w?.color).toBe('brown');
    expect(w?.path).toBeUndefined();
  });

  it('heals every pole of a multi-pole device', () => {
    S().setDiagram(
      doc({
        elements: [
          { id: 'Q1', kind: 'breaker-3p' },
          { id: 'K1', kind: 'contactor-3p' },
          { id: 'M1', kind: 'breaker-3p' },
        ],
        layout: { Q1: { at: [100, 0] }, K1: { at: [100, 100] }, M1: { at: [100, 200] } },
        wires: [
          { id: 'a1', ends: ['Q1.t2', 'K1.t1'] },
          { id: 'a2', ends: ['K1.t2', 'M1.t1'] },
          { id: 'b1', ends: ['Q1.t4', 'K1.t3'] },
          { id: 'b2', ends: ['K1.t4', 'M1.t3'] },
          { id: 'c1', ends: ['Q1.t6', 'K1.t5'] },
          { id: 'c2', ends: ['K1.t6', 'M1.t5'] },
        ],
      }),
    );
    S().setSelection(['K1']);
    S().deleteSelection();
    expect(pairs()).toEqual(
      [pair('Q1.t2', 'M1.t1'), pair('Q1.t4', 'M1.t3'), pair('Q1.t6', 'M1.t5')].sort(),
    );
  });

  it('keeps the shape two bent halves made', () => {
    S().setDiagram(
      doc({
        elements: [
          { id: 'Q1', kind: 'breaker' },
          { id: 'K1', kind: 'make-contact' },
          { id: 'Q2', kind: 'breaker' },
        ],
        // Q1 t2 (0,20); K1 t1 (100,60) t2 (100,120); Q2 t1 (0,280).
        layout: { Q1: { at: [0, 0] }, K1: { at: [100, 100] }, Q2: { at: [0, 300] } },
        wires: [
          { id: 'a', ends: ['Q1.t2', 'K1.t1'], path: [[0, 20], [0, 40], [100, 40], [100, 60]] },
          { id: 'b', ends: ['K1.t2', 'Q2.t1'], path: [[100, 120], [100, 260], [0, 260], [0, 280]] },
        ],
      }),
    );
    S().setSelection(['K1']);
    S().deleteSelection();
    const w = S().diagram.wires?.[0];
    expect(w?.ends).toEqual(['Q1.t2', 'Q2.t1']);
    expect(w?.path).toEqual([
      [0, 20],
      [0, 40],
      [100, 40],
      [100, 260],
      [0, 260],
      [0, 280],
    ]);
  });

  it('does not heal a pin that carries more than one wire, or when the far end goes too', () => {
    S().setDiagram(
      doc({
        elements: [
          { id: 'Q1', kind: 'breaker' },
          { id: 'K1', kind: 'make-contact' },
          { id: 'K2', kind: 'make-contact' },
          { id: 'Q2', kind: 'breaker' },
        ],
        layout: {
          Q1: { at: [0, 0] },
          K1: { at: [0, 100] },
          K2: { at: [0, 200] },
          Q2: { at: [0, 300] },
        },
        wires: [
          { id: 'a', ends: ['Q1.t2', 'K1.t1'] },
          { id: 'b', ends: ['K1.t2', 'K2.t1'] },
          { id: 'c', ends: ['K2.t2', 'Q2.t1'] },
        ],
      }),
    );
    S().setSelection(['K1', 'K2']);
    S().deleteSelection();
    expect(pairs()).toEqual([]);
  });

  it('leaves single-line diagrams alone', () => {
    vertical('sld');
    dropElement('fuse', [100, 100]);
    S().setSelection([newOf('fuse').id]);
    S().deleteSelection();
    expect(pairs()).toEqual([]);
  });

  it('undoes as one step', () => {
    vertical();
    dropElement('make-contact', [100, 100]);
    const after = pairs();
    S().setSelection([newOf('make-contact').id]);
    S().deleteSelection();
    S().undo();
    expect(pairs()).toEqual(after);
  });
});

describe('placing under a rail (circuit diagrams)', () => {
  const rails = (names: string[], extra: Partial<DiagramFile> = {}) =>
    S().setDiagram(
      doc({
        buses: names.map((name, i) => ({
          id: `R${i + 1}`,
          name,
          layout: { at: [200, i * 20], span: 400 },
        })),
        ...extra,
      }),
    );

  it('hangs a single-pole symbol from the nearest rail above', () => {
    rails(['L', 'N']);
    dropElement('make-contact', [150, 120]);
    const k = newOf('make-contact');
    expect(pairs()).toEqual([pair('R2', `${k.id}.t1`)]);
  });

  it('taps L1 / L2 / L3 pole by pole, even with N and PE rails nearer', () => {
    rails(['L1', 'L2', 'L3', 'N', 'PE']);
    dropElement('breaker-3p', [150, 200]);
    const q = { id: S().diagram.elements[0].id };
    expect(pairs()).toEqual(
      [pair('R1', `${q.id}.t1`), pair('R2', `${q.id}.t3`), pair('R3', `${q.id}.t5`)].sort(),
    );
  });

  it('stacks under a device instead when one sits between', () => {
    rails(['L'], {
      elements: [{ id: 'Q1', kind: 'breaker' }],
      layout: { Q1: { at: [150, 60] } },
    });
    dropElement('make-contact', [150, 160]);
    expect(pairs()).toEqual([]);
  });

  it('does nothing out of reach, or on a single-line diagram', () => {
    rails(['L']);
    dropElement('make-contact', [150, 400]);
    expect(pairs()).toEqual([]);
    S().setDiagram(
      doc(
        { buses: [{ id: 'B1', layout: { at: [200, 0], span: 400 } }] },
        'sld',
      ),
    );
    dropElement('make-contact', [150, 120]);
    expect(pairs()).toEqual([]);
  });
});

describe('connectWire with a route', () => {
  it('stores the route a rail branch asks for', () => {
    S().setDiagram(doc({ buses: [{ id: 'R1', layout: { at: [200, 0], span: 400 } }] }));
    S().connectWire({ end: 'R1' }, { junctionAt: [200, 100] }, {
      path: [
        [100, 0],
        [100, 100],
        [200, 100],
      ],
    });
    const w = S().diagram.wires?.[0];
    expect(w?.ends[0]).toBe('R1');
    expect(w?.path).toEqual([
      [100, 0],
      [100, 100],
      [200, 100],
    ]);
  });
});
