/**
 * Fit view frames the whole drawing — devices, buses, junctions, wires, their
 * labels and free annotations — not just `[data-element-id]` nodes.
 *
 * @vitest-environment jsdom
 *
 * jsdom has no layout, so the fit itself is driven against hand-built nodes
 * with stubbed client rects; a real viewer mount checks that every drawn
 * layer actually emits something the fit selector matches.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  FIT_CONTENT_SELECTOR,
  fitToContentWith,
  unionRects,
} from '../../src/canvas/fit-to-content';
import type { Viewport, ViewportApi } from '../../src/canvas/useViewport';
import { OneLineViewer } from '../../src/OneLineViewer';
import type { DiagramFile } from '../../src/model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Box = { left: number; top: number; width: number; height: number };

function stubRect(el: Element, b: Box): void {
  const r = {
    ...b,
    x: b.left,
    y: b.top,
    right: b.left + b.width,
    bottom: b.top + b.height,
    toJSON: () => r,
  };
  el.getBoundingClientRect = () => r as DOMRect;
}

/** Identity screen↔world mapping; records the last viewport set. */
function fakeViewport(): ViewportApi & { last: Partial<Viewport> | null } {
  const api = {
    last: null as Partial<Viewport> | null,
    screenToSvg: (x: number, y: number) => [x, y] as [number, number],
    getViewport: () => ({ tx: 0, ty: 0, scale: 1 }),
    setViewport(p: Partial<Viewport>) {
      api.last = p;
    },
    subscribe: () => () => {},
  };
  return api;
}

function canvasRoot(): HTMLDivElement {
  const root = document.createElement('div');
  stubRect(root, { left: 0, top: 0, width: 1000, height: 1000 });
  return root;
}

function child(root: Element, attr: string, b: Box): void {
  const el = document.createElement('div');
  el.setAttribute(attr, 'x');
  stubRect(el, b);
  root.appendChild(el);
}

describe('unionRects', () => {
  const r = (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  });

  it('unions every non-degenerate rect', () => {
    expect(unionRects([r(10, 20, 5, 5), r(-3, 40, 100, 10)])).toEqual({
      left: -3,
      top: 20,
      right: 97,
      bottom: 50,
    });
  });

  it('keeps a zero-height rect (a horizontal wire) but skips 0×0 ones', () => {
    expect(unionRects([r(0, 0, 0, 0), r(5, 7, 50, 0)])).toEqual({
      left: 5,
      top: 7,
      right: 55,
      bottom: 7,
    });
  });

  it('is null when nothing is measurable', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([r(3, 3, 0, 0)])).toBeNull();
  });
});

describe('fitToContentWith', () => {
  it('frames annotations that reach far past the devices', () => {
    // The prod report: devices in a small band, a title block / table far
    // below. Fitting the devices alone would zoom to the 8× cap.
    const root = canvasRoot();
    child(root, 'data-element-id', { left: 0, top: 0, width: 100, height: 100 });
    child(root, 'data-annotation-id', { left: 0, top: 0, width: 100, height: 1000 });
    const api = fakeViewport();

    expect(fitToContentWith(api, root)).toBe(true);
    // (1000 − 2·60 padding) / 1000 content height.
    expect(api.last?.scale).toBeCloseTo(0.88);
    expect(api.last?.ty).toBeCloseTo(500 - 0.88 * 500);
  });

  it('counts wires, element labels and wire labels', () => {
    const root = canvasRoot();
    child(root, 'data-element-id', { left: 400, top: 400, width: 100, height: 100 });
    child(root, 'data-wire-id', { left: 0, top: 450, width: 900, height: 0 });
    child(root, 'data-element-label', { left: 450, top: 100, width: 20, height: 10 });
    child(root, 'data-wire-label', { left: 450, top: 600, width: 20, height: 300 });
    const api = fakeViewport();

    expect(fitToContentWith(api, root)).toBe(true);
    // Content spans x 0…900, y 100…900 → width-bound: 880 / 900.
    expect(api.last?.scale).toBeCloseTo(880 / 900);
  });

  it('fits a drawing that is only annotations', () => {
    const root = canvasRoot();
    child(root, 'data-annotation-id', { left: 200, top: 200, width: 440, height: 220 });
    const api = fakeViewport();

    expect(fitToContentWith(api, root)).toBe(true);
    expect(api.last?.scale).toBeCloseTo(2);
  });

  it('resets to a centred 100% view on an empty canvas', () => {
    const root = canvasRoot();
    const api = fakeViewport();

    expect(fitToContentWith(api, root)).toBe(true);
    expect(api.last).toEqual({ tx: 500, ty: 500, scale: 1 });
  });

  it('reports not-ready while nothing has been measured yet', () => {
    const root = canvasRoot();
    child(root, 'data-element-id', { left: 0, top: 0, width: 0, height: 0 });
    const api = fakeViewport();

    expect(fitToContentWith(api, root)).toBe(false);
    expect(api.last).toBeNull();
  });
});

describe('FIT_CONTENT_SELECTOR against the real layers', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('matches every kind of drawn object', async () => {
    const diagram: DiagramFile = {
      version: '1',
      elements: [{ id: 'QF1', kind: 'breaker' }],
      buses: [{ id: 'B1', layout: { at: [0, 0], span: 200 } }],
      junctions: [{ id: 'J1', layout: { at: [100, 200] } }],
      layout: { QF1: { at: [0, 80] } },
      wires: [{ id: 'w1', ends: ['B1', 'QF1.t1'], label: 'L1' }],
      annotations: [
        { id: 'T1', at: [0, 2000], text: 'Title block' },
        { id: 'R1', type: 'rect', at: [-300, -300], size: [800, 2400] },
        { id: 'E1', type: 'ellipse', at: [400, 100], size: [60, 40] },
        {
          id: 'N1',
          type: 'line',
          at: [300, 500],
          points: [
            [0, 0],
            [40, 40],
          ],
        },
        {
          id: 'TB1',
          type: 'table',
          at: [500, 2000],
          colWidths: [40, 40],
          rowHeights: [20],
          cells: [['a', 'b']],
        },
      ],
    };
    await act(async () => {
      root.render(<OneLineViewer diagram={diagram} />);
    });

    const matched = Array.from(container.querySelectorAll(FIT_CONTENT_SELECTOR));
    const has = (attr: string, id: string) =>
      matched.some((n) => n.getAttribute(attr) === id);

    expect(has('data-element-id', 'QF1')).toBe(true);
    expect(has('data-bus-id', 'B1')).toBe(true);
    expect(has('data-junction-id', 'J1')).toBe(true);
    expect(has('data-wire-id', 'w1')).toBe(true);
    expect(has('data-element-label', 'QF1')).toBe(true);
    expect(has('data-wire-label', 'w1')).toBe(true);
    for (const id of ['T1', 'R1', 'E1', 'N1', 'TB1']) {
      expect(has('data-annotation-id', id)).toBe(true);
    }
  });
});
