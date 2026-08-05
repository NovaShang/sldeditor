/**
 * Marquee hit-testing covers every selectable object class: devices, buses,
 * junctions and free annotations. Annotations are reported on their own
 * channel because their ids live in a separate namespace from the
 * element/bus/junction one that `selection` holds.
 */

import { describe, expect, it } from 'vitest';
import { compile } from '../../src/compiler';
import { hitsInRect } from '../../src/canvas/marquee-hit';
import type { DiagramFile } from '../../src/model';

/**
 * Two breakers at x=0 and x=400, a bus, a junction, plus four annotations
 * (text / rect / line / table) parked well below everything else.
 * Breaker viewBox is `-7 -22 15 46`, so QF1 spans x ∈ [-7, 8].
 */
const DIAGRAM: DiagramFile = {
  version: '1',
  elements: [
    { id: 'QF1', kind: 'breaker' },
    { id: 'QF2', kind: 'breaker' },
  ],
  buses: [{ id: 'B1', layout: { at: [200, -100], span: 300 } }],
  junctions: [{ id: 'J1', layout: { at: [200, 200] } }],
  layout: { QF1: { at: [0, 0] }, QF2: { at: [400, 0] } },
  annotations: [
    { id: 'A1', at: [0, 500], text: 'note' },
    { id: 'A2', type: 'rect', at: [100, 500], size: [80, 40] },
    {
      id: 'A3',
      type: 'line',
      at: [300, 500],
      points: [
        [0, 0],
        [40, 40],
      ],
    },
    {
      id: 'A4',
      type: 'table',
      at: [500, 500],
      colWidths: [40, 40],
      rowHeights: [20],
      cells: [['a', 'b']],
    },
  ],
};

const model = compile(DIAGRAM);
const hits = (x: number, y: number, w: number, h: number) =>
  hitsInRect(model, DIAGRAM.annotations, { x, y, w, h });

describe('hitsInRect', () => {
  it('picks up a device whose bbox intersects the rect', () => {
    expect(hits(-50, -50, 100, 100).elements).toContain('QF1');
    expect(hits(-50, -50, 100, 100).elements).not.toContain('QF2');
  });

  it('picks up buses and junctions alongside devices', () => {
    const h = hits(-50, -150, 600, 400);
    expect(h.elements).toEqual(
      expect.arrayContaining(['QF1', 'QF2', 'B1', 'J1']),
    );
  });

  it('selects a text annotation covered by the rect', () => {
    const h = hits(-20, 480, 60, 60);
    expect(h.annotations).toEqual(['A1']);
    expect(h.elements).toEqual([]);
  });

  it('selects rect / line / table annotations too', () => {
    expect(hits(90, 490, 100, 60).annotations).toEqual(['A2']);
    expect(hits(290, 490, 60, 60).annotations).toEqual(['A3']);
    expect(hits(490, 490, 100, 40).annotations).toEqual(['A4']);
  });

  it('reports a mixed hit on both channels at once', () => {
    // A band wide enough to swallow the whole drawing.
    const h = hits(-100, -200, 800, 800);
    expect(h.elements).toEqual(
      expect.arrayContaining(['QF1', 'QF2', 'B1', 'J1']),
    );
    expect(h.annotations).toEqual(['A1', 'A2', 'A3', 'A4']);
  });

  it('misses annotations outside the rect', () => {
    expect(hits(-50, -50, 100, 100).annotations).toEqual([]);
  });

  it('tolerates a diagram with no annotations', () => {
    expect(hitsInRect(model, undefined, { x: 0, y: 0, w: 10, h: 10 }).annotations)
      .toEqual([]);
  });
});
