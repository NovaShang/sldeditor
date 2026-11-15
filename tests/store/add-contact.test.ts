/**
 * "Add contact": from a coil, arm the place tool with another contact of the
 * same device; whatever the next click places carries the device tag and its
 * next free terminal numbers, in the placement's own undo step. Renaming a
 * contact to an existing device's tag numbers it the same way.
 *
 * @vitest-environment jsdom
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
import { PlaceTool } from '../../src/canvas/tools/PlaceTool';
import type { ToolContext } from '../../src/canvas/tools/types';
import type { DiagramFile } from '../../src/model';

const store = () => useEditorStore.getState();

const DIAGRAM: DiagramFile = {
  version: '1',
  meta: { diagramType: 'circuit' },
  elements: [
    { id: 'KM1', kind: 'relay-coil', name: '-KM1' },
    { id: 'KM1_13', kind: 'make-contact', name: '-KM1' },
  ],
  layout: { KM1: { at: [0, 200] }, KM1_13: { at: [100, 0] } },
  wires: [],
};

/** What the place tool does with a click on empty canvas at world (x, y). */
function clickAt(x: number, y: number) {
  const ctx = {
    viewport: { screenToSvg: (cx: number, cy: number) => [cx, cy] },
    hostEl: { classList: { add() {}, remove() {} } },
  } as unknown as ToolContext;
  const e = {
    button: 0,
    clientX: x,
    clientY: y,
    target: null,
    pointerId: 1,
    preventDefault() {},
    stopPropagation() {},
  } as unknown as PointerEvent;
  PlaceTool.onPointerDown?.(e, ctx);
  PlaceTool.onPointerUp?.(e, ctx);
}

const newest = () => store().diagram.elements[store().diagram.elements.length - 1];

describe('add contact', () => {
  beforeEach(() => {
    store().setDiagram(structuredClone(DIAGRAM));
    store().setActiveTool('select');
  });

  it('places the next contact of the device, tagged and numbered', () => {
    store().armContact('KM1', 'make-contact');
    expect(store().activeTool).toBe('place');
    expect(store().placeKind).toBe('make-contact');
    clickAt(300, 0);
    expect(newest()).toMatchObject({ kind: 'make-contact', name: '-KM1', pinLabels: { t1: '23', t2: '24' } });
    // Still armed: the next click is the next contact.
    clickAt(400, 0);
    expect(newest()).toMatchObject({ name: '-KM1', pinLabels: { t1: '33', t2: '34' } });
  });

  it('uses the library numbers when they are free (first NC = 21-22)', () => {
    store().armContact('KM1', 'break-contact');
    clickAt(300, 0);
    const nc = newest();
    expect(nc.name).toBe('-KM1');
    expect(nc.pinLabels).toBeUndefined();
  });

  it('is one undo step', () => {
    const before = store().diagram.elements.length;
    store().armContact('KM1', 'make-contact');
    clickAt(300, 0);
    expect(store().diagram.elements.length).toBe(before + 1);
    store().undo();
    expect(store().diagram.elements.length).toBe(before);
  });

  it('disarms when the kind or tool changes', () => {
    store().armContact('KM1', 'make-contact');
    store().setPlaceKind('break-contact');
    expect(store().placeTemplate).toBeNull();
    clickAt(300, 0);
    expect(newest().name).toBeUndefined();

    store().armContact('KM1', 'make-contact');
    store().setActiveTool('select');
    expect(store().placeTemplate).toBeNull();
  });

  it('typing a device tag into a contact numbers it', () => {
    store().addElement('make-contact', [300, 0]);
    const id = newest().id;
    store().updateElement(id, { name: '-KM1' });
    expect(newest()).toMatchObject({ name: '-KM1', pinLabels: { t1: '23', t2: '24' } });
    // One step: undo drops the name and the numbers together.
    store().undo();
    expect(newest().name).toBeUndefined();
    expect(newest().pinLabels).toBeUndefined();
  });

  it('typing a tag leaves single-line diagrams alone', () => {
    store().setDiagram({ ...structuredClone(DIAGRAM), meta: {} });
    store().addElement('make-contact', [300, 0]);
    store().updateElement(newest().id, { name: '-KM1' });
    expect(newest().pinLabels).toBeUndefined();
  });
});
