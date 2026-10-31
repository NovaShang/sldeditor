/**
 * Health checks on circuit diagrams: the single-line rules (supply, voltage,
 * load totals) stay quiet, the generic wiring rules stay, and contacts and
 * coils are matched by device tag. Each tag rule is tested on the drawing it
 * exists to catch and on the legitimate one it must not flag.
 */

import { describe, expect, it } from 'vitest';
import { compile } from '../../src/compiler';
import { checkHealth } from '../../src/health';
import { normalizeTag } from '../../src/health/check';
import { issueText } from '../../src/health/present';
import { t } from '../../src/i18n';
import type { DiagramFile, Element } from '../../src/model';

const run = (d: DiagramFile) => checkHealth(d, compile(d));
const codes = (d: DiagramFile) =>
  run(d)
    .issues.map((i) => `${i.code}:${i.targets[0] ?? ''}`)
    .sort();

/** A wired control circuit: L → S1 → <device> → N, one path per element. */
const circuit = (devices: Element[], type: 'circuit' | 'sld' = 'circuit'): DiagramFile => {
  const d: DiagramFile = {
    version: '1',
    ...(type === 'circuit' ? { meta: { diagramType: 'circuit' } } : {}),
    elements: [],
    buses: [
      { id: 'L', name: 'L', layout: { at: [200, 0], span: 800 } },
      { id: 'N', name: 'N', layout: { at: [200, 400], span: 800 } },
    ],
    wires: [],
    layout: {},
  };
  devices.forEach((el, i) => {
    d.elements.push(el);
    d.layout![el.id] = { at: [i * 80, 200] };
    d.wires!.push({ id: `${el.id}-a`, ends: ['L', `${el.id}.t1`] }, { id: `${el.id}-b`, ends: [`${el.id}.t2`, 'N'] });
  });
  return d;
};

describe('normalizeTag', () => {
  it('reads -KM1, KM1, " km1 ", "−KM1" and a two-line name as one tag', () => {
    for (const n of ['-KM1', 'KM1', ' km1 ', '−KM1', '-KM1\n24 V DC', '- KM1']) {
      expect(normalizeTag(n)).toBe('km1');
    }
    expect(normalizeTag(undefined)).toBe('');
    expect(normalizeTag('  ')).toBe('');
  });
});

describe('device tags', () => {
  it('accepts contacts whose coil carries the same tag, however it is written', () => {
    const d = circuit([
      { id: 'K', kind: 'relay-coil', name: 'KM1' },
      { id: 'C1', kind: 'make-contact', name: '-KM1' },
      { id: 'C2', kind: 'contactor', name: '-km1' },
      { id: 'T', kind: 'time-relay', name: '-KT1' },
      { id: 'C3', kind: 'on-delay-break-contact', name: '-KT1' },
    ]);
    expect(codes(d)).toEqual([]);
  });

  it('flags a contact with no coil of its tag', () => {
    const d = circuit([
      { id: 'K', kind: 'relay-coil', name: '-K1' },
      { id: 'C1', kind: 'make-contact', name: '-K1' },
      { id: 'C2', kind: 'break-contact', name: '-K2' },
    ]);
    const issue = run(d).issues.find((i) => i.code === 'contact-without-operator')!;
    expect(issue).toMatchObject({ id: 'contact-without-operator:C2', severity: 'warning', targets: ['C2'] });
    expect(issue.data?.tag).toBe('-K2');
  });

  it('lets an overload relay own a plain break contact, but not a timed one', () => {
    const d = circuit([
      { id: 'F', kind: 'thermal-overload', name: '-F2' },
      { id: 'C1', kind: 'break-contact', name: '-F2' },
      { id: 'C2', kind: 'on-delay-break-contact', name: '-F2' },
    ]);
    expect(codes(d)).toEqual(['contact-without-operator:C2']);
  });

  it('notes a coil that switches nothing', () => {
    const d = circuit([
      { id: 'K', kind: 'relay-coil', name: '-K3' },
      { id: 'S', kind: 'push-button', name: '-K3' }, // hand-operated: not a contact of K3
    ]);
    const issue = run(d).issues.find((i) => i.code === 'operator-without-contacts')!;
    expect(issue).toMatchObject({ id: 'operator-without-contacts:K', severity: 'info' });
  });

  it('flags one tag on two coils, once, on both', () => {
    const d = circuit([
      { id: 'Kb', kind: 'relay-coil', name: '-KM1' },
      { id: 'Ka', kind: 'relay-coil', name: 'km1' },
      { id: 'C', kind: 'contactor', name: '-KM1' },
    ]);
    const dup = run(d).issues.filter((i) => i.code === 'duplicate-operator');
    expect(dup).toHaveLength(1);
    expect(dup[0]).toMatchObject({ id: 'duplicate-operator:Ka', severity: 'warning', targets: ['Ka', 'Kb'] });
    expect(dup[0].data?.count).toBe(2);
  });

  it('allows a tag repeated on contacts (three main poles drawn one by one)', () => {
    const d = circuit([
      { id: 'K', kind: 'relay-coil', name: '-KM1' },
      { id: 'P1', kind: 'contactor', name: '-KM1' },
      { id: 'P2', kind: 'contactor', name: '-KM1' },
      { id: 'P3', kind: 'contactor', name: '-KM1' },
    ]);
    expect(codes(d)).toEqual([]);
  });

  it('says nothing about untagged devices', () => {
    const d = circuit([
      { id: 'K', kind: 'relay-coil' },
      { id: 'C', kind: 'make-contact' },
    ]);
    expect(codes(d)).toEqual([]);
  });

  it('does not run on a single-line diagram', () => {
    const d = circuit(
      [
        { id: 'K', kind: 'relay-coil', name: '-K1' },
        { id: 'C', kind: 'make-contact', name: '-K2' },
      ],
      'sld',
    );
    expect(codes(d).filter((c) => /operator/.test(c))).toEqual([]);
  });

  it('can be dismissed by its stable id', () => {
    const d = circuit([{ id: 'C', kind: 'make-contact', name: '-K9' }]);
    d.meta = { ...d.meta, healthDismissed: ['contact-without-operator:C'] };
    expect(run(d).issues[0].dismissed).toBe(true);
  });

  it('has words for every new code', () => {
    const d = circuit([
      { id: 'K', kind: 'relay-coil', name: '-K1' },
      { id: 'K2', kind: 'relay-coil', name: '-K1' },
      { id: 'C', kind: 'make-contact', name: '-K9' },
    ]);
    const m = compile(d);
    for (const issue of checkHealth(d, m).issues) {
      const text = issueText(t, m, issue);
      expect(text).not.toContain('health.code');
      expect(text).not.toMatch(/\{\w+\}/);
    }
  });
});

describe('single-line rules on a circuit diagram', () => {
  /** grid → QF1 → bus → QF2 → load; plus a 10 kV bus tied to the 0.4 kV one. */
  const sld = (): DiagramFile => ({
    version: '1',
    elements: [
      { id: 'QF1', kind: 'breaker' },
      { id: 'QF2', kind: 'breaker' },
      { id: 'L1', kind: 'load', params: { P: 0.09 } },
    ],
    buses: [
      { id: 'B1', params: { Un: 0.4 } },
      { id: 'B2', params: { Un: 10 } },
    ],
    wires: [
      { id: 'w2', ends: ['QF1.t2', 'B1'] },
      { id: 'w3', ends: ['B1', 'QF2.t1'] },
      { id: 'w4', ends: ['QF2.t2', 'L1.t_top'] },
      { id: 'w5', ends: ['B1', 'B2'] },
    ],
    layout: { QF1: { at: [0, 60] }, QF2: { at: [0, 160] }, L1: { at: [0, 240] } },
  });

  it('are raised on the single-line version (control for the next test)', () => {
    const c = codes(sld());
    expect(c).toContain('no-origin:');
    expect(c).toContain('open-side:QF1');
    const withGrid = sld();
    withGrid.elements.push({ id: 'G', kind: 'grid-source' }, { id: 'X', kind: 'breaker' });
    withGrid.wires!.push({ id: 'w1', ends: ['G.t_bottom', 'QF1.t1'] }, { id: 'w9', ends: ['B1', 'X.t1'] });
    withGrid.layout = { ...withGrid.layout, G: { at: [0, 0] }, X: { at: [100, 160] } };
    const r = run(withGrid);
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['voltage-mix', 'feeder-end']));
    expect(r.loads.length).toBeGreaterThan(0);
  });

  it('are skipped on a circuit diagram; the generic ones stay', () => {
    const d = sld();
    d.meta = { diagramType: 'circuit' };
    d.elements.push({ id: 'G', kind: 'grid-source' }, { id: 'X', kind: 'breaker' }, { id: 'Q9', kind: 'breaker' });
    d.wires!.push({ id: 'w1', ends: ['G.t_bottom', 'QF1.t1'] }, { id: 'w9', ends: ['B1', 'X.t1'] });
    d.layout = { ...d.layout, G: { at: [0, 0] }, X: { at: [100, 160] }, Q9: { at: [300, 300] } };
    const r = run(d);
    const got = r.issues.map((i) => i.code);
    for (const code of ['no-origin', 'unsupplied', 'supply-disconnected', 'feeder-end', 'overload', 'voltage-mix', 'ratio-mismatch']) {
      expect(got).not.toContain(code);
    }
    expect(got).toContain('unwired'); // Q9
    expect(r.loads).toEqual([]);
  });

  it('keeps the open incoming side note', () => {
    const d = sld();
    d.meta = { diagramType: 'circuit' };
    expect(codes(d)).toContain('open-side:QF1');
  });
});
