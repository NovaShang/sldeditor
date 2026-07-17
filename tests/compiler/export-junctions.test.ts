/**
 * The export SVG (also used by the AI render_diagram feedback loop) follows the
 * schematic solder-dot convention: a dot is drawn only where 3+ conductors meet
 * (a real tee/cross), so a genuine junction stays distinguishable from a plain
 * crossover — but a mere corner or pass-through (degree ≤ 2) gets no dot, which
 * would otherwise falsely read as a tap.
 */

import { describe, expect, it } from 'vitest';
import { compile, LIBRARY } from '../../src/compiler';
import { buildExportSvg } from '../../src/lib/export-image';
import type { DiagramFile } from '../../src/model';

const breaker = LIBRARY.get('breaker');
if (!breaker) throw new Error('breaker kind missing from library');
const pin = (i: number): string => breaker.terminals[i].id;

describe('export with junctions', () => {
  it('draws a solder dot at a 3-way tee (degree 3)', () => {
    const d: DiagramFile = {
      version: '1',
      elements: [
        { id: 'QF1', kind: 'breaker' },
        { id: 'QF2', kind: 'breaker' },
        { id: 'QF3', kind: 'breaker' },
      ],
      junctions: [{ id: 'J1', layout: { at: [100, 100] } }],
      layout: {
        QF1: { at: [0, 0] },
        QF2: { at: [200, 0] },
        QF3: { at: [100, 200] },
      },
      wires: [
        { id: 'w1', ends: [`QF1.${pin(1)}`, 'J1'] },
        { id: 'w2', ends: ['J1', `QF2.${pin(0)}`] },
        { id: 'w3', ends: ['J1', `QF3.${pin(0)}`] },
      ],
    };
    const m = compile(d);
    expect(m.junctions.get('J1')?.degree).toBe(3);
    const svg = buildExportSvg(m);
    expect(svg).toMatch(/<circle id="J1"[^>]*cx="100"[^>]*cy="100"/);
  });

  it('omits the dot at a pass-through (degree 2)', () => {
    const d: DiagramFile = {
      version: '1',
      elements: [
        { id: 'QF1', kind: 'breaker' },
        { id: 'QF2', kind: 'breaker' },
      ],
      junctions: [{ id: 'J1', layout: { at: [100, 100] } }],
      layout: { QF1: { at: [0, 0] }, QF2: { at: [200, 0] } },
      wires: [
        { id: 'w1', ends: [`QF1.${pin(1)}`, 'J1'] },
        { id: 'w2', ends: ['J1', `QF2.${pin(0)}`] },
      ],
    };
    const m = compile(d);
    expect(m.junctions.get('J1')?.degree).toBe(2);
    const svg = buildExportSvg(m);
    expect(svg).not.toContain('id="J1"');
  });
});
