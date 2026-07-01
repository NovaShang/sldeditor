/**
 * Junctions are first-class point connection nodes. These tests pin the
 * compiler contract: wires may terminate on a junction, junctions resolve to
 * a world point (explicit or midpoint-fallback), and bad bare ends still error.
 */

import { describe, expect, it } from 'vitest';
import { compile, LIBRARY } from '../../src/compiler';
import type { DiagramFile } from '../../src/model';

const breaker = LIBRARY.get('breaker');
if (!breaker) throw new Error('breaker kind missing from library');
const pin = (i: number): string => breaker.terminals[i].id;

const errors = (d: DiagramFile) =>
  compile(d).diagnostics.filter((x) => x.severity === 'error');

describe('junction endpoints', () => {
  it('routes wires through a free junction and merges the electrical node', () => {
    const a = `QF1.${pin(1)}`;
    const b = `QF2.${pin(0)}`;
    const d: DiagramFile = {
      version: '1',
      elements: [
        { id: 'QF1', kind: 'breaker' },
        { id: 'QF2', kind: 'breaker' },
      ],
      junctions: [{ id: 'J1', layout: { at: [100, 100] } }],
      layout: { QF1: { at: [0, 0] }, QF2: { at: [200, 0] } },
      wires: [
        { id: 'w1', ends: [a, 'J1'] },
        { id: 'w2', ends: ['J1', b] },
      ],
    };
    const m = compile(d);
    expect(errors(d)).toHaveLength(0);
    expect(m.junctions.get('J1')?.world).toEqual([100, 100]);
    expect(m.wireRenders.has('w1')).toBe(true);
    expect(m.wireRenders.has('w2')).toBe(true);
    // pin → junction → pin all collapse to one connectivity node.
    const n = m.terminalToNode.get('J1');
    expect(n).toBeDefined();
    expect(m.terminalToNode.get(a)).toBe(n);
    expect(m.terminalToNode.get(b)).toBe(n);
  });

  it('falls a positionless junction back to the midpoint of its neighbours', () => {
    const a = `QF1.${pin(1)}`;
    const b = `QF2.${pin(0)}`;
    const d: DiagramFile = {
      version: '1',
      elements: [
        { id: 'QF1', kind: 'breaker' },
        { id: 'QF2', kind: 'breaker' },
      ],
      junctions: [{ id: 'J1' }],
      layout: { QF1: { at: [0, 0] }, QF2: { at: [400, 200] } },
      wires: [
        { id: 'w1', ends: [a, 'J1'] },
        { id: 'w2', ends: ['J1', b] },
      ],
    };
    const m = compile(d);
    const wa = m.terminals.get(a as `${string}.${string}`)!.world;
    const wb = m.terminals.get(b as `${string}.${string}`)!.world;
    const wj = m.junctions.get('J1')!.world;
    expect(wj[0]).toBeCloseTo((wa[0] + wb[0]) / 2);
    expect(wj[1]).toBeCloseTo((wa[1] + wb[1]) / 2);
  });

  it('resolves a chain of positionless junctions instead of collapsing them', () => {
    // Two device groups anchor J1 (left) and J2 (right); J3 wires ONLY to J1
    // and J2 (junction→junction). The old fallback ignored junction neighbours,
    // so J3 collapsed to the origin — it must now sit between J1 and J2.
    const d: DiagramFile = {
      version: '1',
      elements: [
        { id: 'A1', kind: 'breaker' },
        { id: 'A2', kind: 'breaker' },
        { id: 'B1', kind: 'breaker' },
        { id: 'B2', kind: 'breaker' },
      ],
      junctions: [{ id: 'J1' }, { id: 'J2' }, { id: 'J3' }],
      // Devices explicitly placed → the bus-less tree pass is skipped, so the
      // junctions hit the neighbour-centroid fallback (the code under test).
      layout: {
        A1: { at: [0, 0] },
        A2: { at: [100, 0] },
        B1: { at: [400, 0] },
        B2: { at: [500, 0] },
      },
      wires: [
        { id: 'wa1', ends: [`A1.${pin(1)}`, 'J1'] },
        { id: 'wa2', ends: [`A2.${pin(1)}`, 'J1'] },
        { id: 'wb1', ends: [`B1.${pin(1)}`, 'J2'] },
        { id: 'wb2', ends: [`B2.${pin(1)}`, 'J2'] },
        { id: 'wc1', ends: ['J1', 'J3'] },
        { id: 'wc2', ends: ['J2', 'J3'] },
      ],
    };
    const m = compile(d);
    expect(errors(d)).toHaveLength(0);
    const j1 = m.junctions.get('J1')!.world;
    const j2 = m.junctions.get('J2')!.world;
    const j3 = m.junctions.get('J3')!.world;
    expect(j3).not.toEqual([0, 0]); // old bug: collapsed to origin
    expect(j1[0]).toBeLessThan(j3[0]);
    expect(j3[0]).toBeLessThan(j2[0]); // J3 sits between its two junction neighbours
  });

  it('errors on a wire to an id that is neither bus nor junction', () => {
    const d: DiagramFile = {
      version: '1',
      elements: [{ id: 'QF1', kind: 'breaker' }],
      layout: { QF1: { at: [0, 0] } },
      wires: [{ id: 'w', ends: [`QF1.${pin(0)}`, 'NOPE'] }],
    };
    expect(compile(d).diagnostics.some((x) => x.code === 'E003')).toBe(true);
  });

  it('keeps a junction id distinct from a bus id (no collision)', () => {
    const d: DiagramFile = {
      version: '1',
      elements: [{ id: 'QF1', kind: 'breaker' }],
      buses: [{ id: 'B1', layout: { at: [0, 0], span: 200 } }],
      junctions: [{ id: 'J1', layout: { at: [50, 80] } }],
      layout: { QF1: { at: [0, 100] } },
      wires: [
        { id: 'w1', ends: [`QF1.${pin(0)}`, 'B1'] },
        { id: 'w2', ends: [`QF1.${pin(1)}`, 'J1'] },
      ],
    };
    const m = compile(d);
    expect(errors(d)).toHaveLength(0);
    expect(m.buses.has('B1')).toBe(true);
    expect(m.junctions.has('J1')).toBe(true);
    expect(m.wireRenders.size).toBe(2);
  });
});
