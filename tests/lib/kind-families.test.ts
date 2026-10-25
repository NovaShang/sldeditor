/**
 * Delayed contacts and off-page (continuation) connectors.
 *
 * The property panel swaps a contact between NO / NC / four time-delay forms,
 * and a continuation between outgoing / incoming, in place. That is only
 * safe while every member of a family has the same terminals at the same
 * coordinates — the first block holds the library to it. Then: same-named
 * continuations are one conductor, and a swap keeps id, name and wiring.
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

import { compile } from '../../src/compiler';
import { libraryById } from '../../src/element-library';
import { labelLines } from '../../src/lib/element-labels';
import { KIND_FAMILIES, continuationKey, familyOf } from '../../src/lib/kind-families';
import type { DiagramFile } from '../../src/model';
import { useEditorStore } from '../../src/store';

describe('kind families', () => {
  for (const fam of KIND_FAMILIES) {
    it(`${fam.id}: every member exists and puts its terminals on the same spots`, () => {
      // A mirrorOnSwap member is compared after the mirror the swap applies.
      const sig = (k: string, mirrored: boolean) =>
        JSON.stringify(
          libraryById[k]!.terminals.map((t) => [t.id, mirrored ? -t.x : t.x, t.y]),
        );
      for (const k of fam.kinds) expect(libraryById[k], k).toBeDefined();
      const first = sig(fam.kinds[0], false);
      fam.kinds.forEach((k, i) => {
        expect(sig(k, !!fam.mirrorOnSwap && i % 2 === 1), k).toBe(first);
      });
    });
  }

  it('puts every delayed contact next to NO/NC under Control', () => {
    for (const k of familyOf('make-contact')!.kinds) {
      expect(libraryById[k]!.category).toBe('control');
    }
  });

  it('pairs on the trimmed, case-insensitive name and never on an empty one', () => {
    expect(continuationKey(' A1 ')).toBe('a1');
    expect(continuationKey('')).toBeNull();
    expect(continuationKey(undefined)).toBeNull();
  });
});

describe('delayed contacts', () => {
  it('shows the delay beside the tag', () => {
    const d: DiagramFile = {
      version: '1',
      elements: [{ id: 'KT1c', kind: 'on-delay-break-contact', name: 'KT1', params: { delay: 5 } }],
    };
    expect(labelLines(compile(d).elements.get('KT1c')!, 'all')).toEqual(['KT1', '5s']);
  });
});

// Two sheets drawn side by side on one canvas, the feeder leaving sheet 1 at
// connector A1 and arriving on sheet 2 at another A1.
const sheets = (nameB = 'A1', wireB = true): DiagramFile => ({
  version: '1',
  elements: [
    { id: 'QF1', kind: 'breaker' },
    { id: 'X1', kind: 'continuation-out', name: 'A1' },
    { id: 'X2', kind: 'continuation-in', name: nameB },
    { id: 'QF2', kind: 'breaker' },
  ],
  wires: [
    { id: 'w1', ends: ['QF1.t2', 'X1.t1'] },
    ...(wireB ? [{ id: 'w2', ends: ['X2.t1', 'QF2.t1'] as [string, string] }] : []),
  ],
  layout: {
    QF1: { at: [0, 0] },
    X1: { at: [13, 40] },
    X2: { at: [500, 40] },
    QF2: { at: [520, 80] },
  },
});

describe('continuation connectors', () => {
  it('joins same-named connectors into one node', () => {
    const m = compile(sheets());
    expect(m.terminalToNode.get('QF1.t2')).toBe(m.terminalToNode.get('QF2.t1'));
  });

  it('matches names regardless of case and surrounding spaces', () => {
    const m = compile(sheets(' a1 '));
    expect(m.terminalToNode.get('QF1.t2')).toBe(m.terminalToNode.get('QF2.t1'));
  });

  it('keeps differently named connectors apart', () => {
    const m = compile(sheets('A2'));
    expect(m.terminalToNode.get('QF1.t2')).not.toBe(m.terminalToNode.get('QF2.t1'));
  });

  it('still flags a connector with nothing attached, partner or not', () => {
    const m = compile(sheets('A1', false));
    expect(m.diagnostics.some((d) => d.code === 'W001' && d.message.includes('"X2"'))).toBe(true);
  });
});

describe('changeKind', () => {
  beforeEach(() => {
    useEditorStore.getState().setDiagram({
      version: '1',
      elements: [
        { id: 'K1', kind: 'make-contact', name: 'KT1', state: { closed: true }, color: 'red' },
        { id: 'QF1', kind: 'breaker' },
      ],
      wires: [{ id: 'w1', ends: ['K1.t2', 'QF1.t1'] }],
      layout: { K1: { at: [0, 0] }, QF1: { at: [0, 100] } },
    });
  });

  const el = (id: string) => useEditorStore.getState().diagram.elements.find((e) => e.id === id)!;

  it('swaps in place: id, name, colour, placement and wires stay; state goes', () => {
    useEditorStore.getState().changeKind('K1', 'on-delay-break-contact');
    const d = useEditorStore.getState().diagram;
    expect(el('K1')).toEqual({ id: 'K1', kind: 'on-delay-break-contact', name: 'KT1', color: 'red' });
    expect(d.wires).toEqual([{ id: 'w1', ends: ['K1.t2', 'QF1.t1'] }]);
    expect(d.layout!.K1).toEqual({ at: [0, 0] });
  });

  it('keeps the delay between delayed forms and drops it on a plain contact', () => {
    const s = useEditorStore.getState();
    s.changeKind('K1', 'on-delay-make-contact');
    s.updateElement('K1', { params: { delay: 3 } });
    s.changeKind('K1', 'off-delay-make-contact');
    expect(el('K1').params).toEqual({ delay: 3 });
    s.changeKind('K1', 'break-contact');
    expect(el('K1').params).toBeUndefined();
  });

  it('switching a continuation’s direction keeps its terminal where the wire is', () => {
    const s = useEditorStore.getState();
    s.setDiagram({
      version: '1',
      elements: [{ id: 'X1', kind: 'continuation-out', name: 'A1' }, { id: 'QF1', kind: 'breaker' }],
      wires: [{ id: 'w1', ends: ['QF1.t2', 'X1.t1'] }],
      layout: { X1: { at: [100, 60], rot: 90 }, QF1: { at: [100, 0] } },
    });
    const pin = () => useEditorStore.getState().internal.terminals.get('X1.t1' as never)!.world;
    const before = pin();
    s.changeKind('X1', 'continuation-in');
    expect(pin()).toEqual(before);
    expect(useEditorStore.getState().diagram.layout!.X1).toEqual({ at: [100, 60], rot: 90, mirror: true });
    s.changeKind('X1', 'continuation-out');
    expect(pin()).toEqual(before);
    expect(useEditorStore.getState().diagram.layout!.X1).toEqual({ at: [100, 60], rot: 90 });
  });

  it('is one undo step', () => {
    const s = useEditorStore.getState();
    s.changeKind('K1', 'break-contact');
    s.undo();
    expect(el('K1').kind).toBe('make-contact');
  });
});
