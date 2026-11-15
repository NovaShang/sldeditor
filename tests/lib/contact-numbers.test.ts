/**
 * Terminal numbers of a device's contacts (IEC 60947-5-1 / EN 50005): first
 * digit = the contact's place in the device, second = its function (1-2 NC,
 * 3-4 NO, 5-6 / 7-8 delayed). The library's own numbers win while their
 * place is free.
 */

import { describe, expect, it } from 'vitest';
import {
  contactDeviceOf,
  contactOptions,
  nextContactPins,
  pinLabelsOnRename,
  usedSequences,
} from '../../src/lib/contact-numbers';
import type { DiagramFile, Element } from '../../src/model';

const circuit = (elements: Element[]): DiagramFile => ({
  version: '1',
  meta: { diagramType: 'circuit' },
  elements,
  wires: [],
});

describe('nextContactPins', () => {
  it('numbers the contacts of a contactor 13-14, 21-22, 33-34, 41-42…', () => {
    const d = circuit([{ id: 'K', kind: 'relay-coil', name: '-KM1' }]);
    expect(nextContactPins(d, '-KM1', 'make-contact')).toEqual({ t1: '13', t2: '14' });
    d.elements.push({ id: 'a', kind: 'make-contact', name: '-KM1' });
    expect(nextContactPins(d, '-KM1', 'break-contact')).toEqual({ t1: '21', t2: '22' });
    d.elements.push({ id: 'b', kind: 'break-contact', name: '-KM1' });
    expect(nextContactPins(d, '-KM1', 'make-contact')).toEqual({ t1: '33', t2: '34' });
    d.elements.push({ id: 'c', kind: 'make-contact', name: '-KM1', pinLabels: { t1: '33', t2: '34' } });
    expect(nextContactPins(d, '-KM1', 'break-contact')).toEqual({ t1: '41', t2: '42' });
  });

  it('gives a second make contact 23-24 (the demo drawing’s numbering)', () => {
    const d = circuit([
      { id: 'K', kind: 'relay-coil', name: '-KM1' },
      { id: 'a', kind: 'make-contact', name: '-KM1' },
    ]);
    expect(nextContactPins(d, '-KM1', 'make-contact')).toEqual({ t1: '23', t2: '24' });
  });

  it('keeps a timer’s delayed numbers 55-56 / 67-68, then moves on', () => {
    const d = circuit([{ id: 'T', kind: 'time-relay', name: '-KT1' }]);
    expect(nextContactPins(d, '-KT1', 'on-delay-break-contact')).toEqual({ t1: '55', t2: '56' });
    expect(nextContactPins(d, '-KT1', 'on-delay-make-contact')).toEqual({ t1: '67', t2: '68' });
    d.elements.push({ id: 'x', kind: 'on-delay-make-contact', name: '-KT1' });
    // Place 6 taken: lowest free place, still the delayed-make function digits.
    expect(nextContactPins(d, '-KT1', 'off-delay-make-contact')).toEqual({ t1: '17', t2: '18' });
  });

  it('matches tags with or without the dash, any case; ignores other devices', () => {
    const d = circuit([
      { id: 'K', kind: 'relay-coil', name: 'KM1' },
      { id: 'a', kind: 'make-contact', name: '-km1' },
      { id: 'b', kind: 'make-contact', name: '-KM2' },
    ]);
    expect([...usedSequences(d, '-KM1')]).toEqual([1]);
  });

  it('does not number main contacts (1-2 / 3-4 / 5-6)', () => {
    const d = circuit([{ id: 'K', kind: 'relay-coil', name: '-KM1' }]);
    expect(nextContactPins(d, '-KM1', 'contactor-3p')).toBeNull();
    d.elements.push({ id: 'P', kind: 'contactor-3p', name: '-KM1' });
    expect(usedSequences(d, '-KM1').size).toBe(0);
  });
});

describe('contactDeviceOf / contactOptions', () => {
  it('a coil, a contactor or a contact of one is a device', () => {
    const d = circuit([
      { id: 'K', kind: 'relay-coil', name: '-KM1' },
      { id: 'a', kind: 'make-contact', name: '-KM1' },
      { id: 'lone', kind: 'make-contact', name: '-KM7' },
      { id: 'S', kind: 'push-button', name: '-S1' },
      { id: 'u', kind: 'relay-coil' },
    ]);
    const el = (id: string) => d.elements.find((e) => e.id === id)!;
    expect(contactDeviceOf(d, el('K'))?.members.map((m) => m.id)).toEqual(['K', 'a']);
    expect(contactDeviceOf(d, el('a'))?.tag).toBe('-KM1');
    expect(contactDeviceOf(d, el('lone'))).toBeNull();
    expect(contactDeviceOf(d, el('S'))).toBeNull();
    expect(contactDeviceOf(d, el('u'))).toBeNull();
  });

  it('offers delayed contacts for timers, main contacts for a -KM without them', () => {
    const kinds = (els: Element[], tag: string) => contactOptions(els, tag).map((o) => o.kind);
    expect(kinds([{ id: 'K', kind: 'relay-coil', name: '-K1' }], '-K1')).toEqual(['make-contact', 'break-contact']);
    expect(kinds([{ id: 'K', kind: 'relay-coil', name: '-KM1' }], '-KM1')).toContain('contactor-3p');
    expect(
      kinds(
        [
          { id: 'K', kind: 'relay-coil', name: '-KM1' },
          { id: 'P', kind: 'contactor-3p', name: '-KM1' },
        ],
        '-KM1',
      ),
    ).not.toContain('contactor-3p');
    expect(kinds([{ id: 'T', kind: 'time-relay', name: '-KT1' }], '-KT1')).toEqual([
      'make-contact',
      'break-contact',
      'on-delay-make-contact',
      'on-delay-break-contact',
      'off-delay-make-contact',
      'off-delay-break-contact',
    ]);
  });
});

describe('pinLabelsOnRename', () => {
  const base = () =>
    circuit([
      { id: 'K', kind: 'relay-coil', name: '-KM1' },
      { id: 'a', kind: 'make-contact', name: '-KM1' },
      { id: 'new', kind: 'make-contact' },
      { id: 'nc', kind: 'break-contact' },
    ]);

  it('numbers a contact renamed to a device with its next free pins', () => {
    expect(pinLabelsOnRename(base(), 'new', '-KM1')).toEqual({ t1: '23', t2: '24' });
  });

  it('leaves pins alone when they are free on the device', () => {
    // 21-22 is the first NC of -KM1: nothing to change.
    expect(pinLabelsOnRename(base(), 'nc', '-KM1')).toBeNull();
    const d = base();
    d.elements[2].pinLabels = { t1: '43', t2: '44' };
    expect(pinLabelsOnRename(d, 'new', '-KM1')).toBeNull();
  });

  it('leaves pins alone for unknown tags, non-contacts and no-op renames', () => {
    expect(pinLabelsOnRename(base(), 'new', '-KM9')).toBeNull();
    expect(pinLabelsOnRename(base(), 'K', '-KM1')).toBeNull();
    expect(pinLabelsOnRename(base(), 'a', '-KM1')).toBeNull();
    expect(pinLabelsOnRename(base(), 'new', undefined)).toBeNull();
  });
});
