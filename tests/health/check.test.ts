/**
 * Health check. Every rule is tested twice: once on the drawing it exists to
 * catch, once on the legitimate drawing it must NOT flag — the second half is
 * what the 2026-10-24 evaluation on real user drawings was about (target:
 * ≤ 10% false alarms among warnings).
 */

import { describe, expect, it } from 'vitest';
import { compile } from '../../src/compiler';
import { checkHealth, parseRatio, sameVoltageLevel } from '../../src/health';
import type { DiagramFile } from '../../src/model';

const run = (d: DiagramFile) => checkHealth(d, compile(d));
const codes = (d: DiagramFile, sev?: string) =>
  run(d)
    .issues.filter((i) => !sev || i.severity === sev)
    .map((i) => `${i.code}:${i.targets[0] ?? ''}`)
    .sort();

/** grid → QF1 → bus B1 → QF2 → load L1 (P in MW on the generic load). */
const radial = (extra: Partial<DiagramFile> = {}): DiagramFile => ({
  version: '1',
  elements: [
    { id: 'G', kind: 'grid-source' },
    { id: 'QF1', kind: 'breaker' },
    { id: 'QF2', kind: 'breaker' },
    { id: 'L1', kind: 'load', params: { P: 0.09 } },
  ],
  buses: [{ id: 'B1', params: { Un: 0.4 } }],
  wires: [
    { id: 'w1', ends: ['G.t_bottom', 'QF1.t1'] },
    { id: 'w2', ends: ['QF1.t2', 'B1'] },
    { id: 'w3', ends: ['B1', 'QF2.t1'] },
    { id: 'w4', ends: ['QF2.t2', 'L1.t_top'] },
  ],
  layout: {
    G: { at: [0, 0] }, QF1: { at: [0, 60] }, QF2: { at: [0, 160] }, L1: { at: [0, 240] },
  },
  ...extra,
});

describe('a clean radial drawing', () => {
  it('raises nothing', () => {
    expect(codes(radial())).toEqual([]);
  });

  it('adds up the load behind the bus', () => {
    const l = run(radial()).loads.find((x) => x.targetId === 'B1')!;
    expect(l.knownKW).toBeCloseTo(90);
    expect(l.known).toBe(1);
    expect(l.total).toBe(1);
  });
});

describe('wiring', () => {
  it('flags a device with nothing attached', () => {
    const d = radial();
    d.elements.push({ id: 'QF9', kind: 'breaker' });
    expect(codes(d, 'warning')).toContain('unwired:QF9');
  });

  it('says which bus an unwired device is sitting on', () => {
    const d = radial();
    d.elements.push({ id: 'QF9', kind: 'breaker' });
    d.layout = { ...d.layout, QF9: { at: [300, 100] } };
    const pin = compile(d).terminals.get('QF9.t1')!.world;
    d.buses!.push({ id: 'B9', layout: { at: [pin[0], pin[1]], span: 80 } });
    const issue = run(d).issues.find((i) => i.id === 'unwired:QF9')!;
    expect(issue.data?.touching).toBe('B9');
  });

  it('does not flag relays, meters, CTs or earth placed without a wire', () => {
    const d = radial();
    d.elements.push(
      { id: 'R1', kind: 'overcurrent-relay' },
      { id: 'A1', kind: 'ammeter' },
      { id: 'CT1', kind: 'ct' },
      { id: 'E1', kind: 'earth' },
    );
    expect(codes(d, 'warning')).toEqual([]);
  });

  it('treats a feeder drawn to a breaker and no further as a note', () => {
    const d = radial();
    d.wires = d.wires!.filter((w) => w.id !== 'w4');
    d.elements = d.elements.filter((e) => e.id !== 'L1');
    expect(codes(d, 'warning')).toEqual([]);
    expect(codes(d, 'info')).toContain('feeder-end:QF2');
  });

  it('calls out a wire that ends on top of a terminal without joining it', () => {
    const d = radial();
    // QF2.t2 sits at (0, 180); a wire from L1 stops at a junction there.
    d.junctions = [{ id: 'J1', layout: { at: [0, 180] } }];
    d.wires = [...d.wires!.filter((w) => w.id !== 'w4'), { id: 'w5', ends: ['J1', 'L1.t_top'] }];
    expect(codes(d, 'warning')).toContain('looks-joined:J1');
    // …and names the pin it sits on, for the panel's one-click Connect.
    expect(run(d).issues.find((i) => i.id === 'looks-joined:J1')!.data?.joins).toBe('QF2.t2');
  });

  it('only notes a wire end in open space (an incoming or outgoing line)', () => {
    const d = radial();
    d.junctions = [{ id: 'J2', layout: { at: [400, -200] } }];
    d.wires = [...d.wires!, { id: 'w6', ends: ['J2', 'B1'] }];
    expect(codes(d, 'warning')).toEqual([]);
    expect(codes(d, 'info')).toContain('dangling-wire:J2');
  });

  it('skips an unwired neutral or earth bar', () => {
    const d = radial({ buses: [{ id: 'B1', params: { Un: 0.4 } }, { id: 'BN', name: 'N' }, { id: 'BX' }] });
    expect(codes(d, 'warning')).toEqual(['unwired:BX']);
  });
});

describe('supply', () => {
  it('reports a cut-off branch as one unsupplied group', () => {
    const d = radial();
    d.elements.push({ id: 'QF3', kind: 'breaker' }, { id: 'L2', kind: 'load' });
    d.wires!.push({ id: 'w7', ends: ['QF3.t2', 'L2.t_top'] });
    const r = run(d).issues.filter((i) => i.code === 'unsupplied');
    expect(r).toHaveLength(1);
    expect(r[0].targets).toEqual(['L2', 'QF3']);
  });

  it('carries supply through control contacts to the loads behind them', () => {
    const d = radial();
    d.elements.push({ id: 'S1', kind: 'push-button' }, { id: 'L2', kind: 'load' });
    d.wires!.push({ id: 'w7', ends: ['B1', 'S1.t1'] }, { id: 'w8', ends: ['S1.t2', 'L2.t_top'] });
    expect(codes(d, 'warning')).toEqual([]);
  });

  it('reports a supply that feeds nothing once, on the supply', () => {
    const d = radial();
    d.wires = d.wires!.filter((w) => w.id !== 'w1');
    d.elements.push({ id: 'E', kind: 'earth' });
    d.wires.push({ id: 'w0', ends: ['G.t_bottom', 'E.t1'] });
    expect(codes(d, 'warning')).toEqual(['supply-disconnected:G']);
  });

  it('without any supply symbol, gives one note and no island warnings', () => {
    const d = radial();
    d.elements = d.elements.filter((e) => e.id !== 'G');
    d.wires = d.wires!.filter((w) => w.id !== 'w1');
    expect(codes(d, 'warning')).toEqual([]);
    expect(codes(d, 'info')).toContain('no-origin:');
  });
});

describe('voltage', () => {
  it('flags two voltage levels joined without a transformer', () => {
    const d = radial({ buses: [{ id: 'B1', params: { Un: 0.4 } }, { id: 'B2', params: { Un: 10 } }] });
    d.wires!.push({ id: 'w9', ends: ['B1', 'B2'] });
    expect(codes(d, 'error')).toEqual(['voltage-mix:B1']);
  });

  it('accepts 230 V and 400 V on one network, and 380/400/415 V as one level', () => {
    expect(sameVoltageLevel(0.23, 0.4)).toBe(true);
    expect(sameVoltageLevel(0.38, 0.415)).toBe(true);
    expect(sameVoltageLevel(0.4, 10)).toBe(false);
  });

  it('accepts levels separated by a transformer, and checks its ratio', () => {
    const base = (ratio: string): DiagramFile => ({
      version: '1',
      elements: [
        { id: 'G', kind: 'grid-source' },
        { id: 'T1', kind: 'transformer-2w', params: { S: 1, ratio } },
      ],
      buses: [{ id: 'HV', params: { Un: 10 } }, { id: 'LV', params: { Un: 0.4 } }],
      wires: [
        { id: 'a', ends: ['G.t_bottom', 'HV'] },
        { id: 'b', ends: ['HV', 'T1.t1'] },
        { id: 'c', ends: ['T1.t2', 'LV'] },
      ],
    });
    expect(codes(base('10/0.4'))).toEqual([]);
    expect(codes(base('10kV/400V'))).toEqual([]);
    expect(codes(base('35/10.5'))).toEqual(['ratio-mismatch:T1']);
  });

  it('reads unit-less ratios as kV or V, whichever fits', () => {
    expect(parseRatio('10/0.4')).toEqual([10, 0.4]);
    expect(parseRatio('11000/415')).toEqual([11, 0.415]);
    const d: DiagramFile = {
      version: '1',
      elements: [{ id: 'G', kind: 'grid-source' }, { id: 'T1', kind: 'transformer-2w', params: { ratio: '380/220' } }],
      buses: [{ id: 'A', params: { Un: 0.38 } }, { id: 'B', params: { Un: 0.22 } }],
      wires: [{ id: 'a', ends: ['G.t_bottom', 'A'] }, { id: 'b', ends: ['A', 'T1.t1'] }, { id: 'c', ends: ['T1.t2', 'B'] }],
    };
    expect(codes(d)).toEqual([]);
  });
});

describe('labels', () => {
  const named = (name: string, params: Record<string, number>, kind = 'breaker') => {
    const d = radial();
    d.elements = d.elements.map((e) => (e.id === 'QF2' ? { ...e, kind, name, params } : e));
    return codes(d, 'warning');
  };

  it('flags a rating in the name that disagrees with the parameter', () => {
    expect(named('QF2 30A', { In: 200 })).toEqual(['label-mismatch:QF2']);
  });

  it('never reads amps against breaking capacity, or a model code as a rating', () => {
    expect(named('Main 4P 63A', { In: 63, Icu: 10 })).toEqual([]);
    expect(named('A-3AH05（R23-05A）', { In: 630 })).toEqual([]);
  });

  it('reads decimal commas and leaves multiplied figures alone', () => {
    const d = radial();
    d.elements = d.elements.map((e) => (e.id === 'L1' ? { ...e, name: 'CNC - 15,5 kW', params: { P: 0.0155 } } : e));
    expect(codes(d, 'warning')).toEqual([]);
    d.elements = d.elements.map((e) => (e.id === 'L1' ? { ...e, name: '16×150kW racks', params: { P: 2.4 } } : e));
    expect(codes(d, 'warning')).toEqual([]);
  });
});

describe('load roll-up', () => {
  const withTx = (S: number, loadsMW: (number | undefined)[]): DiagramFile => ({
    version: '1',
    elements: [
      { id: 'G', kind: 'grid-source' },
      { id: 'T1', kind: 'transformer-2w', params: { S } },
      ...loadsMW.map((p, i) => ({ id: `L${i}`, kind: 'load', ...(p === undefined ? {} : { params: { P: p } }) })),
    ],
    buses: [{ id: 'LV', params: { Un: 0.4 } }],
    wires: [
      { id: 'a', ends: ['G.t_bottom', 'T1.t1'] },
      { id: 'b', ends: ['T1.t2', 'LV'] },
      ...loadsMW.map((_, i) => ({ id: `l${i}`, ends: ['LV', `L${i}.t_top`] as [string, string] })),
    ],
  });

  it('gives transformer loading, honest about unknown loads', () => {
    const t = run(withTx(1, [0.27, undefined, 0.18])).loads.find((l) => l.targetId === 'T1')!;
    expect(t.known).toBe(2);
    expect(t.total).toBe(3);
    expect(t.loadingPct).toBeCloseTo(50); // 450 kW / 0.9 = 500 kVA of 1000
  });

  it('warns only past 125% of the rating; a little over is a note', () => {
    expect(codes(withTx(1, [1.08]), 'warning')).toEqual([]); // 1200 kVA = 120%
    expect(codes(withTx(1, [1.08]), 'info')).toContain('overload:T1');
    expect(codes(withTx(1, [1.35]), 'warning')).toEqual(['overload:T1']); // 150%
  });

  it('shares a board between parallel transformers by rating', () => {
    const d = withTx(1, [0.27, 0.27, 0.36]); // 900 kW → 1000 kVA
    d.elements.push({ id: 'T2', kind: 'transformer-2w', params: { S: 0.5 } });
    d.wires!.push({ id: 'a2', ends: ['G.t_bottom', 'T2.t1'] }, { id: 'b2', ends: ['T2.t2', 'LV'] });
    const r = run(d);
    const t1 = r.loads.find((l) => l.targetId === 'T1')!;
    const t2 = r.loads.find((l) => l.targetId === 'T2')!;
    // 1000 kVA over 1500 kVA of transformers: both at 67%, not 100% and 200%.
    expect(t1.loadingPct).toBeCloseTo(66.67, 1);
    expect(t2.loadingPct).toBeCloseTo(66.67, 1);
    expect(t1.knownKVA + t2.knownKVA).toBeCloseTo(1000);
    expect(t1.parallelWith).toEqual(['T2']);
    expect(r.issues.filter((i) => i.code === 'overload')).toEqual([]);
  });

  it('reads the new kW rating on motors, and legacy MW values on them too', () => {
    const d = withTx(1, []);
    d.elements.push({ id: 'M1', kind: 'async-motor', params: { P: 7.5 } }, { id: 'M2', kind: 'async-motor', params: { P: 0.0075 } });
    d.wires!.push({ id: 'm1', ends: ['LV', 'M1.t1'] }, { id: 'm2', ends: ['LV', 'M2.t1'] });
    expect(run(d).loads.find((l) => l.targetId === 'LV')!.knownKW).toBeCloseTo(15);
  });
});

describe('dismissal', () => {
  it('marks issues the user called intentional', () => {
    const d = radial();
    d.elements.push({ id: 'QF9', kind: 'breaker' });
    d.meta = { healthDismissed: ['unwired:QF9'] };
    expect(run(d).issues.find((i) => i.id === 'unwired:QF9')!.dismissed).toBe(true);
  });
});
