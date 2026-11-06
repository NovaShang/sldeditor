/**
 * Device tags on placement: on a circuit diagram a newly placed device gets
 * the next free IEC 81346 tag of its letter code (-Q1, -KM2…) as its name;
 * a single-line diagram keeps its ids exactly as before.
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

import { useEditorStore } from '../../src/store';
import { dropElement, dropElementFromTerminal } from '../../src/canvas/drop-on-bus';
import { newCircuitTag } from '../../src/store/id-allocator';
import type { DiagramFile, Element } from '../../src/model';

const circuit = (elements: Element[] = []): DiagramFile => ({
  version: '1',
  meta: { diagramType: 'circuit' },
  elements,
  wires: [],
});

function place(kind: string, extra?: Partial<Element>): Element {
  const id = useEditorStore.getState().addElement(kind, [0, 0], extra);
  return useEditorStore.getState().diagram.elements.find((e) => e.id === id)!;
}

describe('circuit diagram: placed devices are tagged', () => {
  beforeEach(() => {
    useEditorStore.getState().setDiagram(circuit());
  });

  it('numbers each letter code on its own', () => {
    expect(place('breaker-3p')).toMatchObject({ id: 'Q1', name: '-Q1' });
    expect(place('switch-disconnector-3p').name).toBe('-Q2');
    expect(place('motor-breaker-3p').name).toBe('-Q3');
    expect(place('contactor-3p')).toMatchObject({ id: 'KM1', name: '-KM1' });
    expect(place('contactor-3p').name).toBe('-KM2');
    expect(place('relay-coil').name).toBe('-K1');
    expect(place('time-relay').name).toBe('-KT1');
    expect(place('fuse').name).toBe('-F1');
    expect(place('mcb-1pn').name).toBe('-F2');
    expect(place('rcd').name).toBe('-F3');
    expect(place('overload-relay-3p').name).toBe('-F4');
    expect(place('push-button').name).toBe('-S1');
    expect(place('emergency-stop').name).toBe('-S2');
    expect(place('indicator-light').name).toBe('-H1');
    expect(place('motor-3ph').name).toBe('-M1');
    expect(place('terminal-block').name).toBe('-X1');
    expect(place('transformer-2w').name).toBe('-T1');
    expect(place('power-supply').name).toBe('-G1');
  });

  it('skips tags already in the drawing, whoever carries them', () => {
    useEditorStore.getState().setDiagram(
      circuit([
        // A coil and its contact share the contactor's tag.
        { id: 'KM1', kind: 'relay-coil', name: '-KM1' },
        { id: 'KM1_13', kind: 'make-contact', name: '-KM1' },
        // A terminal on strip -X1, and a tag written over two lines.
        { id: 'X1_3', kind: 'terminal-block', name: '-X1:3' },
        { id: 'Qa', kind: 'breaker-3p', name: '-Q1\n63 A' },
        // Unnamed: its id is what the canvas shows.
        { id: 'S1', kind: 'push-button' },
      ]),
    );
    expect(place('contactor-3p')).toMatchObject({ id: 'KM2', name: '-KM2' });
    expect(place('terminal-block').name).toBe('-X2');
    expect(place('breaker-3p').name).toBe('-Q2');
    expect(place('push-button').name).toBe('-S2');
    // -KM1 is not a -K tag.
    expect(place('relay-coil').name).toBe('-K1');
  });

  it('fills the lowest free number and never reuses an id', () => {
    useEditorStore.getState().setDiagram(
      circuit([
        { id: 'Q1', kind: 'breaker-3p', name: '-Q3' },
        { id: 'feed', kind: 'breaker-3p', name: '-Q2' },
      ]),
    );
    // -Q1 is free as a tag, but the id Q1 is taken.
    const el = place('breaker-3p');
    expect(el.name).toBe('-Q1');
    expect(el.id).not.toBe('Q1');
    expect(new Set(useEditorStore.getState().diagram.elements.map((e) => e.id)).size).toBe(3);
  });

  it('leaves contacts, and callers that name the device, alone', () => {
    const contact = place('make-contact');
    expect(contact.name).toBeUndefined();
    expect(contact.id).toBe('make-contact1');
    expect(place('contactor-3p', { name: '-KM9' }).name).toBe('-KM9');
    expect(newCircuitTag(circuit(), 'earth')).toBeNull();
  });
});

describe('circuit diagram: every placement path tags', () => {
  beforeEach(() => {
    useEditorStore.getState().setDiagram({
      version: '1',
      meta: { diagramType: 'circuit' },
      elements: [{ id: 'Q1', kind: 'breaker-3p', name: '-Q1' }],
      buses: [{ id: 'L', name: 'L', layout: { at: [0, 0], span: 400 } }],
      wires: [],
      layout: { Q1: { at: [400, 200] } },
    });
  });

  it('a drop that taps a rail', () => {
    const r = dropElement('fuse', [20, 10]);
    expect(r.attachedToBus).toBe(true);
    const el = useEditorStore.getState().diagram.elements.find((e) => e.id === r.newElementId)!;
    expect(el.name).toBe('-F1');
  });

  it('a drag out of a pin', () => {
    const r = dropElementFromTerminal('contactor-3p', 'Q1.t2', [400, 320])!;
    const el = useEditorStore.getState().diagram.elements.find((e) => e.id === r.newElementId)!;
    expect(el.name).toBe('-KM1');
  });
});

describe('single-line diagram: unchanged', () => {
  it('mints ids as before and names nothing', () => {
    useEditorStore.getState().setDiagram({ version: '1', elements: [], wires: [] });
    expect(place('breaker')).toMatchObject({ id: 'QF1' });
    expect(place('breaker').name).toBeUndefined();
    expect(place('breaker-3p').id).toBe('breaker-3p1');
    expect(place('contactor').name).toBeUndefined();
  });
});
