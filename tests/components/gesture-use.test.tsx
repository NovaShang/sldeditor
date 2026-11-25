/**
 * `onToolUse` also reports the circuit gestures that are not palette tools —
 * add contact, quick insert, drop on a wire, rail branch and rail hang —
 * once each one has actually changed the drawing (never when a menu opens or
 * a drag merely starts).
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useToolUseReporter, type ToolUseEvent } from '../../src/hooks/use-tool-use';
import { useEditorStore } from '../../src/store';
import { PlaceTool } from '../../src/canvas/tools/PlaceTool';
import { SelectTool } from '../../src/canvas/tools/SelectTool';
import type { ToolContext } from '../../src/canvas/tools/types';
import { dropElement } from '../../src/canvas/drop-on-bus';
import { quickInsertPlace, useQuickInsert } from '../../src/components/quick-insert-state';
import type { DiagramFile } from '../../src/model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe(props: { onToolUse?: (e: ToolUseEvent) => void; readOnly?: boolean }) {
  useToolUseReporter(props.onToolUse, props.readOnly);
  return null;
}

const S = () => useEditorStore.getState();

let host: HTMLDivElement;
let root: Root;
let seen: ToolUseEvent[];

const doc = (d: Partial<DiagramFile>, type: 'circuit' | 'sld' = 'circuit'): DiagramFile => ({
  version: '1',
  ...(type === 'circuit' ? { meta: { diagramType: 'circuit' } } : {}),
  elements: [],
  wires: [],
  ...d,
});

/** Only the gesture events (tool switches are covered by tool-use.test). */
const gestures = () => seen.filter((e) => e.kind === 'gesture').map((e) => e.tool);

function ctx(): ToolContext {
  return {
    viewport: { screenToSvg: (cx: number, cy: number) => [cx, cy] },
    hostEl: Object.assign(document.createElement('div'), {
      setPointerCapture() {},
      releasePointerCapture() {},
      hasPointerCapture: () => false,
    }),
  } as unknown as ToolContext;
}

function pointer(x: number, y: number, target: EventTarget | null = null): PointerEvent {
  return {
    button: 0,
    clientX: x,
    clientY: y,
    target,
    pointerId: 1,
    shiftKey: false,
    altKey: false,
    preventDefault() {},
    stopPropagation() {},
  } as unknown as PointerEvent;
}

function placeClick(x: number, y: number) {
  const c = ctx();
  PlaceTool.onPointerDown?.(pointer(x, y), c);
  PlaceTool.onPointerUp?.(pointer(x, y), c);
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  seen = [];
  act(() => {
    S().setDiagram(doc({}));
    S().setActiveTool('select');
  });
  act(() => root.render(<Probe onToolUse={(e) => seen.push(e)} />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useQuickInsert.setState({ at: null });
});

describe('onToolUse gestures', () => {
  it('add contact: reported when the contact is placed, not when it is armed', () => {
    act(() =>
      S().setDiagram(
        doc({
          elements: [{ id: 'KM1', kind: 'relay-coil', name: '-KM1' }],
          layout: { KM1: { at: [0, 400] } },
        }),
      ),
    );
    act(() => S().armContact('KM1', 'make-contact'));
    expect(gestures()).toEqual([]);
    act(() => placeClick(300, 0));
    expect(gestures()).toEqual(['add_contact']);
    expect(seen.find((e) => e.tool === 'add_contact')).toEqual({
      tool: 'add_contact',
      diagramType: 'circuit',
      kind: 'gesture',
    });
  });

  it('a plain placement is not an add-contact', () => {
    act(() => S().setActiveTool('place', { placeKind: 'make-contact' }));
    act(() => placeClick(300, 0));
    expect(gestures()).toEqual([]);
  });

  it('quick insert: reported when the pick is placed, not when the palette opens', () => {
    act(() => useQuickInsert.setState({ at: { screen: [0, 0], world: [300, 0], source: null } }));
    expect(gestures()).toEqual([]);
    act(() => quickInsertPlace('make-contact', { screen: [0, 0], world: [300, 0], source: null }));
    expect(gestures()).toEqual(['quick_insert']);
  });

  it('drop on a wire: reported when the symbol goes in line', () => {
    act(() =>
      S().setDiagram(
        doc({
          elements: [
            { id: 'Q1', kind: 'breaker' },
            { id: 'Q2', kind: 'breaker' },
          ],
          layout: { Q1: { at: [100, 0] }, Q2: { at: [100, 200] } },
          wires: [{ id: 'w1', ends: ['Q1.t2', 'Q2.t1'] }],
        }),
      ),
    );
    act(() => {
      dropElement('make-contact', [300, 100]); // away from the wire
    });
    expect(gestures()).toEqual([]);
    act(() => {
      dropElement('make-contact', [103, 100]);
    });
    expect(gestures()).toEqual(['insert_on_wire']);
  });

  it('rail hang: reported when a placement is wired up to the rail above', () => {
    act(() =>
      S().setDiagram(
        doc({ buses: [{ id: 'R1', name: 'L', layout: { at: [200, 0], span: 400 } }] }),
      ),
    );
    act(() => {
      dropElement('make-contact', [150, 400]); // out of reach
    });
    expect(gestures()).toEqual([]);
    act(() => {
      dropElement('make-contact', [150, 120]);
    });
    expect(gestures()).toEqual(['rail_hang']);
  });

  it('rail branch: reported when a conductor is pulled out of a rail, not on a click', () => {
    act(() =>
      S().setDiagram(
        doc({ buses: [{ id: 'R1', name: 'L', layout: { at: [200, 0], span: 400 } }] }),
      ),
    );
    const rail = document.createElement('div');
    rail.setAttribute('data-bus-id', 'R1');
    rail.setAttribute('data-element-id', 'R1');
    host.appendChild(rail);
    // jsdom has no hit testing: nothing is under the release point.
    document.elementFromPoint = () => null;
    const c = ctx();
    // Press and release without moving: selects the rail.
    act(() => SelectTool.onPointerDown?.(pointer(100, 0, rail), c));
    act(() => SelectTool.onPointerUp?.(pointer(100, 0, rail), c));
    expect(gestures()).toEqual([]);
    act(() => S().clearSelection());
    act(() => SelectTool.onPointerDown?.(pointer(100, 0, rail), c));
    act(() => SelectTool.onPointerUp?.(pointer(100, 100, null), c));
    expect((S().diagram.wires ?? []).length).toBe(1);
    expect(gestures()).toEqual(['rail_branch']);
  });

  it('reports no gestures in read-only mode', () => {
    act(() => root.render(<Probe onToolUse={(e) => seen.push(e)} readOnly />));
    act(() => quickInsertPlace('make-contact', { screen: [0, 0], world: [300, 0], source: null }));
    expect(gestures()).toEqual([]);
  });
});
