/**
 * Enclosures — a tagged frame around a panel / cabinet / junction box.
 *
 * The model the tests pin: the frame owns nothing. A plain drag moves the
 * frame alone (fitting a box round a finished drawing must never disturb the
 * drawing); an Alt-drag carries whatever lies inside it at that moment, in
 * one undo step. A marquee catches the frame only when it swallows it whole,
 * so rubber-banding devices inside a panel never drags the outline along.
 *
 * @vitest-environment jsdom
 *
 * (jsdom for the DXF writer's `DOMParser` and the select tool's DOM hit-test.)
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

import { compile } from '../../src/compiler';
import {
  annotationBBox,
  ENCLOSURE_NAME_FONT_SIZE,
} from '../../src/lib/annotation-geom';
import { buildExportSvg } from '../../src/lib/export-image';
import { buildExportDxf } from '../../src/lib/export-dxf';
import { hitsInRect } from '../../src/canvas/marquee-hit';
import { enclosureContentIds } from '../../src/canvas/sheet-hit';
import { SelectTool } from '../../src/canvas/tools/SelectTool';
import type { ToolContext } from '../../src/canvas/tools/types';
import { useEditorStore } from '../../src/store';
import type { DiagramFile, EnclosureAnnotation } from '../../src/model';

const ENC: EnclosureAnnotation = {
  id: 'E1',
  type: 'enclosure',
  at: [0, 0],
  size: [200, 120],
  name: '=+A1 ADU panel',
};

const DIAGRAM: DiagramFile = {
  version: '1',
  elements: [
    { id: 'QF1', kind: 'breaker' },
    { id: 'QF2', kind: 'breaker' },
  ],
  // QF1 inside the frame, QF2 well outside it.
  layout: { QF1: { at: [60, 60] }, QF2: { at: [400, 60] } },
  annotations: [ENC, { id: 'T1', at: [20, 20], text: 'inside' }],
};

describe('geometry', () => {
  it('bounds include the name tag above the frame', () => {
    const bb = annotationBBox(ENC);
    expect(bb.minY).toBeLessThan(-ENCLOSURE_NAME_FONT_SIZE + 1);
    expect(bb.maxY).toBe(120);
    expect(bb.minX).toBe(0);
  });

  it('bounds are just the frame when unnamed', () => {
    expect(annotationBBox({ ...ENC, name: undefined })).toEqual({
      minX: 0,
      minY: 0,
      maxX: 200,
      maxY: 120,
    });
  });
});

describe('marquee', () => {
  const m = compile({ version: '1', elements: [] });
  it('does not catch the frame on a partial overlap', () => {
    expect(hitsInRect(m, [ENC], { x: 10, y: 10, w: 50, h: 50 }).annotations).toEqual([]);
  });
  it('catches the frame when it is swallowed whole', () => {
    expect(
      hitsInRect(m, [ENC], { x: -10, y: -30, w: 300, h: 200 }).annotations,
    ).toEqual(['E1']);
  });
});

describe('contents', () => {
  it('are what lies inside the frame, never the frame itself', () => {
    const c = enclosureContentIds(DIAGRAM, compile(DIAGRAM), ENC);
    expect(c.elements).toEqual(['QF1']);
    expect(c.annotations).toEqual(['T1']);
  });
});

describe('export', () => {
  const m = compile({ version: '1', elements: [] });
  it('draws a dashed frame and the name in SVG', () => {
    const svg = buildExportSvg(m, { annotations: [ENC] });
    expect(svg).toContain('width="200" height="120"');
    expect(svg).toContain('stroke-dasharray="6 4"');
    expect(svg).toContain('=+A1 ADU panel');
  });

  it('writes the frame and name to an ENCLOSURES layer in DXF', () => {
    const dxf = buildExportDxf(m, { annotations: [ENC] });
    expect(dxf).toMatch(/^ENCLOSURES$/m);
    expect(dxf).toContain('=+A1 ADU panel');
  });

  it('declares no ENCLOSURES layer for a drawing without one', () => {
    const dxf = buildExportDxf(m, { annotations: [{ id: 'r', type: 'rect', at: [0, 0], size: [10, 10] }] });
    expect(dxf).not.toMatch(/ENCLOSURES/);
  });
});

// ---- Select tool gestures --------------------------------------------------

const store = () => useEditorStore.getState();

function hostWithFrame(): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML =
    '<svg><g data-annotation-id="E1"><rect class="ole-ann-shape-hit"/></g></svg>';
  document.body.appendChild(host);
  Object.assign(host, {
    hasPointerCapture: () => false,
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
  });
  return host;
}

function drag(host: HTMLElement, alt: boolean, dx: number, dy: number) {
  const ctx = {
    viewport: { screenToSvg: (x: number, y: number) => [x, y] },
    hostEl: host,
  } as unknown as ToolContext;
  const target = host.querySelector('rect')!;
  const ev = (x: number, y: number) =>
    ({
      button: 0,
      pointerId: 1,
      clientX: x,
      clientY: y,
      altKey: alt,
      shiftKey: false,
      target,
      preventDefault() {},
      stopPropagation() {},
    }) as unknown as PointerEvent;
  SelectTool.onPointerDown!(ev(0, 50), ctx);
  SelectTool.onPointerMove!(ev(dx, 50 + dy), ctx);
  SelectTool.onPointerUp!(ev(dx, 50 + dy), ctx);
}

describe('dragging the frame', () => {
  beforeEach(() => {
    store().setDiagram(structuredClone(DIAGRAM));
  });

  it('plain drag moves the frame only', () => {
    drag(hostWithFrame(), false, 40, 20);
    const d = store().diagram;
    expect(d.annotations!.find((a) => a.id === 'E1')!.at).toEqual([40, 20]);
    expect(d.layout!.QF1.at).toEqual([60, 60]);
    expect(d.annotations!.find((a) => a.id === 'T1')!.at).toEqual([20, 20]);
  });

  it('Alt-drag carries what is inside, in one undo step', () => {
    drag(hostWithFrame(), true, 40, 20);
    const d = store().diagram;
    expect(d.annotations!.find((a) => a.id === 'E1')!.at).toEqual([40, 20]);
    expect(store().internal.layout.get('QF1')!.at).toEqual([100, 80]);
    expect(store().internal.layout.get('QF2')!.at).toEqual([400, 60]);
    expect(d.annotations!.find((a) => a.id === 'T1')!.at).toEqual([60, 40]);
    store().undo();
    const u = store().diagram;
    expect(u.annotations!.find((a) => a.id === 'E1')!.at).toEqual([0, 0]);
    expect(store().internal.layout.get('QF1')!.at).toEqual([60, 60]);
  });
});

describe('store', () => {
  it('inserting an enclosure is one undo step, and it survives a save/load round trip', () => {
    store().setDiagram({ version: '1', elements: [] });
    const id = store().insertAnnotation({ type: 'enclosure', at: [0, 0], size: [50, 50], name: 'JB1' });
    const saved = JSON.parse(JSON.stringify(store().diagram)) as DiagramFile;
    expect(saved.annotations).toEqual([
      { id, type: 'enclosure', at: [0, 0], size: [50, 50], name: 'JB1' },
    ]);
    store().undo();
    expect(store().diagram.annotations ?? []).toEqual([]);
    store().setDiagram(saved);
    expect(store().diagram.annotations?.[0]).toMatchObject({ type: 'enclosure', name: 'JB1' });
  });
});
