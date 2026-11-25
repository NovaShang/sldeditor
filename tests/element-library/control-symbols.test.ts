/**
 * Control-circuit symbols: solenoid valve, photocell (light-operated switch),
 * changeover contact, 2-pole contactor contacts and the PLC I/O cards.
 *
 * Each is a QElectroTech drawing, so beyond "it exists" this pins down what
 * other code keys off: the pin designations, which pins sit where, the tag a
 * newly placed one gets on a circuit diagram, and that the contact numbering
 * of a relay with two changeovers reads 11-12-14 / 21-22-24.
 */

import { describe, expect, it } from 'vitest';
import { LIBRARY } from '../../src/compiler';
import { OPERATED_KINDS } from '../../src/health/roles';
import { contactOptions, nextContactPins } from '../../src/lib/contact-numbers';
import { entrySearchTexts, searchTokens } from '../../src/lib/library-search';
import { circuitTagCode } from '../../src/store/id-allocator';
import { libTextIn } from '../../src/i18n/library';
import type { LibraryEntry } from '../../src/model';
import type { DiagramFile } from '../../src/model';

const NEW_KINDS = [
  'solenoid-valve',
  'photocell',
  'changeover-contact',
  'contactor-2p',
  'plc-inputs-8',
  'plc-outputs-8',
];

const entry = (id: string) => LIBRARY.get(id) as LibraryEntry;
const labelsOf = (id: string) => Object.fromEntries(entry(id).terminals.map((t) => [t.id, t.label]));
const pin = (id: string, t: string) => entry(id).terminals.find((x) => x.id === t)!;

/** Whether `query` finds `id` the way the palette does (every token somewhere). */
function finds(id: string, query: string): boolean {
  const s = entrySearchTexts(entry(id), 'en');
  const hay = [...s.names, ...s.keywords, s.id, ...s.descriptions].join(' ').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return searchTokens(query).every((tok) => hay.includes(tok));
}

describe('control-circuit symbols', () => {
  it.each(NEW_KINDS)('%s is converted from a QElectroTech element', (id) => {
    const e = entry(id);
    expect(e, id).toBeDefined();
    expect(e.source.kind).toBe('elmt');
  });

  it.each(NEW_KINDS)('%s has a name in every library locale', (id) => {
    for (const l of ['en', 'es', 'fr', 'de', 'pt', 'ja', 'ru', 'fa', 'ar', 'he'] as const) {
      expect(libTextIn(l, `${id}.name`, ''), `${id} ${l}`).not.toBe('');
      expect(libTextIn(l, `${id}.desc`, ''), `${id} ${l}`).not.toBe('');
    }
  });

  it('solenoid valve: a coil, A1 on top, A2 below', () => {
    expect(labelsOf('solenoid-valve')).toEqual({ t1: 'A1', t2: 'A2' });
    expect([pin('solenoid-valve', 't1').orientation, pin('solenoid-valve', 't2').orientation]).toEqual(['n', 's']);
    expect(pin('solenoid-valve', 't1').y).toBeLessThan(pin('solenoid-valve', 't2').y);
    expect(entry('solenoid-valve').series).toBeUndefined();
  });

  it('photocell: a light-operated make contact, in series like a switch', () => {
    expect(labelsOf('photocell')).toEqual({ t1: '13', t2: '14' });
    expect(pin('photocell', 't1').y).toBeLessThan(pin('photocell', 't2').y);
    expect(entry('photocell').series).toBe(true);
  });

  it('changeover contact: common 11 below, break 12 and make 14 above', () => {
    expect(labelsOf('changeover-contact')).toEqual({ t1: '14', t2: '11', t3: '12' });
    // t1 / t2 where the make contact has them, so the two line up in a column.
    for (const t of ['t1', 't2']) {
      const a = pin('changeover-contact', t);
      const b = pin('make-contact', t);
      expect([a.x, a.y, a.orientation]).toEqual([b.x, b.y, b.orientation]);
    }
    expect(pin('changeover-contact', 't3').orientation).toBe('n');
  });

  it('2-pole contactor contacts: poles at x = −20 / 0, pins 1-2 and 3-4', () => {
    const byLabel = Object.fromEntries(entry('contactor-2p').terminals.map((t) => [t.label, t]));
    expect(Object.keys(byLabel).sort()).toEqual(['1', '2', '3', '4']);
    expect([byLabel['1'].x, byLabel['1'].orientation, byLabel['2'].x, byLabel['2'].orientation]).toEqual([-20, 'n', -20, 's']);
    expect([byLabel['3'].x, byLabel['3'].orientation, byLabel['4'].x, byLabel['4'].orientation]).toEqual([0, 'n', 0, 's']);
    expect(entry('contactor-2p').diagramTypes).toEqual(['circuit']);
    expect(entry('contactor-2p').series).toBe(true);
  });

  it('PLC input card: L+, L−, I0.0…I0.7 along the top, 40 apart', () => {
    const ts = entry('plc-inputs-8').terminals;
    expect(ts.map((t) => t.label)).toEqual(['L+', 'L-', 'I0.0', 'I0.1', 'I0.2', 'I0.3', 'I0.4', 'I0.5', 'I0.6', 'I0.7']);
    expect(new Set(ts.map((t) => t.orientation))).toEqual(new Set(['n']));
    expect(new Set(ts.map((t) => t.y)).size).toBe(1);
    ts.slice(1).forEach((t, i) => expect(t.x - ts[i].x).toBe(40));
    expect(entry('plc-inputs-8').diagramTypes).toEqual(['circuit']);
  });

  it('PLC output card: L+, L−, Q0.0…Q0.7 along the bottom', () => {
    const ts = entry('plc-outputs-8').terminals;
    expect(ts.map((t) => t.label)).toEqual(['L+', 'L-', 'Q0.0', 'Q0.1', 'Q0.2', 'Q0.3', 'Q0.4', 'Q0.5', 'Q0.6', 'Q0.7']);
    expect(new Set(ts.map((t) => t.orientation))).toEqual(new Set(['s']));
    ts.slice(1).forEach((t, i) => expect(t.x - ts[i].x).toBe(40));
    expect(entry('plc-outputs-8').diagramTypes).toEqual(['circuit']);
  });

  it('a newly placed one is tagged by its IEC 81346 letter code', () => {
    expect(circuitTagCode('solenoid-valve')).toBe('MB');
    expect(circuitTagCode('photocell')).toBe('B');
    expect(circuitTagCode('contactor-2p')).toBe('KM');
    expect(circuitTagCode('plc-inputs-8')).toBe('K');
    expect(circuitTagCode('plc-outputs-8')).toBe('K');
    // A contact takes its operator's tag.
    expect(circuitTagCode('changeover-contact')).toBeUndefined();
  });

  it('a relay with two changeovers numbers them 11-12-14 and 21-22-24', () => {
    const d: DiagramFile = {
      version: '1',
      meta: { diagramType: 'circuit' },
      elements: [
        { id: 'K1', kind: 'relay-coil', name: '-K1' },
        { id: 'K1a', kind: 'changeover-contact', name: '-K1' },
      ],
    };
    expect(contactOptions(d.elements, '-K1').map((o) => o.kind)).toContain('changeover-contact');
    expect(nextContactPins(d, '-K1', 'changeover-contact')).toEqual({ t1: '24', t2: '21', t3: '22' });
  });

  it('their contacts belong to a coil', () => {
    expect(OPERATED_KINDS['changeover-contact']).toEqual(['coil']);
    expect(OPERATED_KINDS['contactor-2p']).toEqual(['coil']);
  });

  it.each([
    ['solenoid-valve', 'solenoid'],
    ['solenoid-valve', '电磁阀'],
    ['solenoid-valve', 'Magnetventil'],
    ['photocell', 'photocell'],
    ['photocell', 'dusk to dawn'],
    ['photocell', '光控'],
    ['changeover-contact', 'DPDT'],
    ['changeover-contact', 'Wechsler'],
    ['contactor-2p', 'DP contactor'],
    ['contactor-2p', 'double pole relay'],
    ['plc-inputs-8', 'PLC'],
    ['plc-outputs-8', 'PLC'],
    ['plc-inputs-8', 'SPS'],
  ])('%s is found by "%s"', (id, q) => {
    expect(finds(id, q)).toBe(true);
  });
});
