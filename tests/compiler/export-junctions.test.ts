/**
 * The export SVG (also used by the AI render_diagram feedback loop) must draw
 * a junction dot, otherwise a 3-way tee is indistinguishable from a crossover
 * and the AI can't see junctions it placed.
 */

import { describe, expect, it } from 'vitest';
import { compile, LIBRARY } from '../../src/compiler';
import { buildExportSvg } from '../../src/lib/export-image';
import type { DiagramFile } from '../../src/model';

const breaker = LIBRARY.get('breaker');
if (!breaker) throw new Error('breaker kind missing from library');
const pin = (i: number): string => breaker.terminals[i].id;

describe('export with junctions', () => {
  it('renders a junction dot in the export SVG', () => {
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
    const svg = buildExportSvg(compile(d));
    expect(svg).toContain('id="J1"');
    expect(svg).toMatch(/<circle id="J1"[^>]*cx="100"[^>]*cy="100"/);
  });
});
