/**
 * Bus-less (radial / tree) diagrams get a proper top-down tree layout instead
 * of the old cramped strip: a source at the top, flow descending, and branches
 * spreading horizontally at a junction.
 */

import { describe, expect, it } from 'vitest';
import { compile, LIBRARY } from '../../src/compiler';
import type { DiagramFile } from '../../src/model';

const grid = LIBRARY.get('grid-source');
const breaker = LIBRARY.get('breaker');
if (!grid || !breaker) throw new Error('expected kinds missing from library');
const gOut = grid.terminals[0].id;
const bp = (i: number) => breaker.terminals[i].id;

describe('bus-less tree layout', () => {
  it('lays a source→chain→junction→branches diagram top-down, no overlap', () => {
    // SRC → QF1 → J1 ─┬─ QF2
    //                 └─ QF3      (no buses, no explicit layout)
    const d: DiagramFile = {
      version: '1',
      elements: [
        { id: 'SRC1', kind: 'grid-source' },
        { id: 'QF1', kind: 'breaker' },
        { id: 'QF2', kind: 'breaker' },
        { id: 'QF3', kind: 'breaker' },
      ],
      junctions: [{ id: 'J1' }],
      wires: [
        { id: 'w1', ends: [`SRC1.${gOut}`, `QF1.${bp(0)}`] },
        { id: 'w2', ends: [`QF1.${bp(1)}`, 'J1'] },
        { id: 'w3', ends: ['J1', `QF2.${bp(0)}`] },
        { id: 'w4', ends: ['J1', `QF3.${bp(0)}`] },
      ],
    };
    const m = compile(d);
    expect(m.diagnostics.filter((x) => x.severity === 'error')).toHaveLength(0);

    const y = (id: string) => m.layout.get(id)!.at[1];
    const at = (id: string): [number, number] =>
      (m.layout.get(id)?.at ?? m.junctions.get(id)!.world) as [number, number];

    // Source is at the top; flow descends to the junction and the branches.
    expect(y('SRC1')).toBeLessThan(y('QF1'));
    expect(y('QF1')).toBeLessThan(m.junctions.get('J1')!.world[1]);
    expect(m.junctions.get('J1')!.world[1]).toBeLessThan(y('QF2'));

    // The two branches sit at the same tier but different columns.
    expect(y('QF2')).toBe(y('QF3'));
    expect(at('QF2')[0]).not.toBe(at('QF3')[0]);

    // No two nodes collapse onto (nearly) the same point.
    const ids = ['SRC1', 'QF1', 'QF2', 'QF3', 'J1'];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const a = at(ids[i]);
        const b = at(ids[j]);
        expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(60);
      }
  });

  it('leaves explicit placements untouched (no tree layout when user-placed)', () => {
    const d: DiagramFile = {
      version: '1',
      elements: [
        { id: 'QF1', kind: 'breaker' },
        { id: 'QF2', kind: 'breaker' },
      ],
      junctions: [{ id: 'J1', layout: { at: [777, 333] } }],
      layout: { QF1: { at: [10, 20] }, QF2: { at: [200, 20] } },
      wires: [
        { id: 'w1', ends: [`QF1.${bp(1)}`, 'J1'] },
        { id: 'w2', ends: ['J1', `QF2.${bp(0)}`] },
      ],
    };
    const m = compile(d);
    expect(m.layout.get('QF1')!.at).toEqual([10, 20]);
    expect(m.layout.get('QF2')!.at).toEqual([200, 20]);
    expect(m.junctions.get('J1')!.world).toEqual([777, 333]);
  });
});
