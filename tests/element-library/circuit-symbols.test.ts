/**
 * Circuit-diagram symbols and pin designations.
 *
 * Other code keys off these by id: the canvas prints `label`s next to the
 * pins, the health checks pair contacts with their coil by kind, the AI is
 * told which terminal is "A1". So beyond "the JSON is well-formed" this pins
 * down the contract: the designations themselves, the pole geometry that lets
 * a breaker, contactor and overload relay stack with straight wires, and that
 * every pin sits on the end of a drawn lead (a pin in empty space leaves the
 * wire stopping short of the symbol).
 */

import { describe, expect, it } from 'vitest';
import { LIBRARY } from '../../src/compiler';
import { DIAGRAM_TYPES } from '../../src/model';
import type { LibraryEntry } from '../../src/model';

const GRID = 10;
const entries = [...LIBRARY.values()];
const labelled = entries.filter((e) => e.terminals.some((t) => t.label !== undefined));
const circuitOnly = entries.filter((e) => e.diagramTypes?.includes('circuit'));

const labelsOf = (id: string) =>
  Object.fromEntries(LIBRARY.get(id)!.terminals.map((t) => [t.id, t.label]));

/** Every stroke end point in a symbol's artwork: line ends and poly vertices. */
function strokeEnds(entry: LibraryEntry): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (const m of entry.svg.matchAll(/<line\b([^>]*)\/>/g)) {
    const a = (k: string) => Number(new RegExp(`\\b${k}="([^"]+)"`).exec(m[1])![1]);
    pts.push([a('x1'), a('y1')], [a('x2'), a('y2')]);
  }
  for (const m of entry.svg.matchAll(/<poly(?:line|gon)\b[^>]*\bpoints="([^"]+)"/g)) {
    for (const p of m[1].trim().split(/\s+/)) {
      const [x, y] = p.split(',').map(Number);
      pts.push([x, y]);
    }
  }
  return pts;
}

describe('pin designations', () => {
  it.each(labelled.map((e) => [e.id, e]))('%s: labels are non-empty and unique', (_id, entry) => {
    const labels = entry.terminals.map((t) => t.label).filter((l) => l !== undefined);
    for (const l of labels) expect(l).toMatch(/\S/);
    // A neutral pole is N on both sides (IEC 60947: N-N) — the only label
    // allowed twice, once on the line side and once on the load side.
    const neutral = entry.terminals.filter((t) => t.label === 'N');
    if (neutral.length > 1) {
      expect(neutral.map((t) => t.orientation).sort()).toEqual(['n', 's']);
    }
    const others = labels.filter((l) => l !== 'N');
    expect(new Set(others).size).toBe(others.length);
  });

  it.each(labelled.map((e) => [e.id, e]))('%s: terminals sit on the grid', (_id, entry) => {
    const off = entry.terminals
      .filter((t) => Math.abs(t.x % GRID) + Math.abs(t.y % GRID) > 1e-9)
      .map((t) => `${t.id} (${t.x}, ${t.y})`);
    expect(off).toEqual([]);
  });

  it('existing control symbols carry the IEC 60947 / EN 50005 designations', () => {
    expect(labelsOf('relay-coil')).toEqual({ t1: 'A1', t2: 'A2' });
    expect(labelsOf('time-relay')).toEqual({ t1: 'A1', t2: 'A2' });
    expect(labelsOf('make-contact')).toEqual({ t1: '13', t2: '14' });
    expect(labelsOf('break-contact')).toEqual({ t1: '21', t2: '22' });
    expect(labelsOf('on-delay-make-contact')).toEqual({ t1: '67', t2: '68' });
    expect(labelsOf('off-delay-make-contact')).toEqual({ t1: '67', t2: '68' });
    expect(labelsOf('on-delay-break-contact')).toEqual({ t1: '55', t2: '56' });
    expect(labelsOf('off-delay-break-contact')).toEqual({ t1: '55', t2: '56' });
    expect(labelsOf('push-button')).toEqual({ t1: '13', t2: '14' });
    expect(labelsOf('selector-switch')).toEqual({ t1: '13', t2: '14' });
    expect(labelsOf('limit-switch')).toEqual({ t1: '13', t2: '14' });
    expect(labelsOf('indicator-light')).toEqual({ t1: 'X1', t2: 'X2' });
    // Leads outside the lamp, symmetric about its centre.
    expect(LIBRARY.get('indicator-light')!.terminals.map((t) => [t.id, t.x, t.y])).toEqual([
      ['t1', 0, -20],
      ['t2', 0, 20],
    ]);
    // Matches the "1"/"2" glyphs QET ships, which circuit diagrams hide.
    expect(labelsOf('breaker')).toEqual({ t1: '1', t2: '2' });
  });

  it('new circuit symbols carry their designations', () => {
    expect(labelsOf('supply-3ph')).toEqual({ t_l1: 'L1', t_l2: 'L2', t_l3: 'L3', t_n: 'N', t_pe: 'PE' });
    expect(labelsOf('motor-3ph')).toEqual({ t_u: 'U', t_v: 'V', t_w: 'W', t_pe: 'PE' });
    expect(labelsOf('motor-3ph-6t')).toEqual({
      t_u1: 'U1', t_v1: 'V1', t_w1: 'W1', t_u2: 'U2', t_v2: 'V2', t_w2: 'W2', t_pe: 'PE',
    });
    expect(labelsOf('rcd-4p')).toMatchObject({ t_n1: 'N', t_n2: 'N' });
    expect(labelsOf('mcb-1pn')).toEqual({ t1: '1', t2: '2', t_n1: 'N', t_n2: 'N' });
    expect(labelsOf('push-button-break')).toEqual({ t1: '11', t2: '12' });
    expect(labelsOf('emergency-stop')).toEqual({ t1: '11', t2: '12' });
    expect(labelsOf('limit-switch-break')).toEqual({ t1: '11', t2: '12' });
    expect(labelsOf('overload-contact-break')).toEqual({ t1: '95', t2: '96' });
    expect(labelsOf('overload-contact-make')).toEqual({ t1: '97', t2: '98' });
    // A feed-through terminal's number is per instance (-X1:3), not a default.
    expect(labelsOf('terminal-block')).toEqual({ t1: undefined, t2: undefined });
  });
});

describe('multi-pole power symbols', () => {
  const THREE_POLE = [
    'breaker-3p',
    'motor-breaker-3p',
    'fuse-3p',
    'switch-disconnector-3p',
    'contactor-3p',
    'overload-relay-3p',
    'rcd-4p',
  ];

  it.each(THREE_POLE)('%s: poles at x = −20 / 0 / 20, 1/3/5 on the line side', (id) => {
    const byId = Object.fromEntries(LIBRARY.get(id)!.terminals.map((t) => [t.id, t]));
    [-20, 0, 20].forEach((x, i) => {
      const top = byId[`t${2 * i + 1}`];
      const bottom = byId[`t${2 * i + 2}`];
      expect([top.x, top.orientation, top.label]).toEqual([x, 'n', String(2 * i + 1)]);
      expect([bottom.x, bottom.orientation, bottom.label]).toEqual([x, 's', String(2 * i + 2)]);
      expect(top.y).toBeLessThan(bottom.y);
    });
  });

  it('the supply and the 4-pole RCD put L1–L3 on the same x as the 3-pole symbols, N at 40', () => {
    const xs = (id: string) => LIBRARY.get(id)!.terminals.map((t) => [t.label, t.x]);
    expect(xs('supply-3ph')).toEqual([['L1', -20], ['L2', 0], ['L3', 20], ['N', 40], ['PE', 60]]);
    expect(xs('rcd-4p').filter(([l]) => l === 'N').map(([, x]) => x)).toEqual([40, 40]);
    expect(xs('motor-3ph').slice(0, 3)).toEqual([['U', -20], ['V', 0], ['W', 20]]);
    // Star-delta motor: winding starts on top, ends straight below them.
    const m6 = Object.fromEntries(LIBRARY.get('motor-3ph-6t')!.terminals.map((t) => [t.label, t]));
    for (const [i, ph] of ['U', 'V', 'W'].entries()) {
      expect([m6[`${ph}1`].x, m6[`${ph}1`].orientation]).toEqual([-20 + 20 * i, 'n']);
      expect([m6[`${ph}2`].x, m6[`${ph}2`].orientation]).toEqual([-20 + 20 * i, 's']);
    }
    expect(m6.PE.orientation).toBe('e');
  });

  // Labelled symbols too: the designation is printed beside the lead, so a
  // pin with no lead (the lamp's used to sit on its circle) puts it on the body.
  const withLeads = [...new Set([...circuitOnly, ...labelled])];
  it.each(withLeads.map((e) => [e.id, e]))('%s: every terminal sits on the end of a drawn lead', (_id, entry) => {
    const ends = strokeEnds(entry);
    for (const t of entry.terminals) {
      const hit = ends.some(([x, y]) => Math.abs(x - t.x) < 1e-6 && Math.abs(y - t.y) < 1e-6);
      expect([t.id, hit]).toEqual([t.id, true]);
    }
  });
});

describe('diagramTypes', () => {
  it.each(entries.filter((e) => e.diagramTypes).map((e) => [e.id, e]))('%s: valid values', (_id, entry) => {
    const types = entry.diagramTypes!;
    expect(types.length).toBeGreaterThan(0);
    expect(new Set(types).size).toBe(types.length);
    for (const t of types) expect(DIAGRAM_TYPES).toContain(t);
  });

  it('no symbol is hidden from both drawing types', () => {
    for (const e of entries) {
      if (e.diagramTypes) expect([e.id, e.diagramTypes.length]).not.toEqual([e.id, 0]);
    }
  });

  it('the symbols a control circuit needs stay available in both types', () => {
    for (const id of [
      'relay-coil', 'time-relay', 'make-contact', 'break-contact', 'push-button',
      'selector-switch', 'indicator-light', 'limit-switch', 'breaker', 'fuse',
      'contactor', 'busbar', 'terminal',
    ]) {
      expect([id, LIBRARY.get(id)!.diagramTypes]).toEqual([id, undefined]);
    }
  });
});
