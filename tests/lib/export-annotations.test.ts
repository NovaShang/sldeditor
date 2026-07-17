/**
 * Exports must render every annotation variant — and must keep accepting
 * pre-union files whose text annotations carry no `type` (back-compat).
 * The AI render_diagram feedback loop consumes the same SVG, so a shape
 * that renders on canvas but not in export would be invisible to the agent.
 */

import { describe, expect, it } from 'vitest';
import { compile } from '../../src/compiler';
import { buildExportSvg } from '../../src/lib/export-image';
import { buildExportDxf } from '../../src/lib/export-dxf';
import type { Annotation, DiagramFile } from '../../src/model';

const EMPTY: DiagramFile = { version: '1', elements: [] };

const ANNS: Annotation[] = [
  // Typeless text — the pre-union on-disk shape. Must render as text.
  { id: 'a1', at: [0, 0], text: 'legacy note' },
  {
    id: 'a2',
    type: 'rect',
    at: [100, 100],
    size: [120, 80],
    stroke: 'dashed',
    fill: 'tint',
    label: 'Panel #1',
  },
  {
    id: 'a3',
    type: 'line',
    at: [300, 100],
    points: [
      [0, 0],
      [100, 0],
    ],
    arrow: 'end',
  },
  {
    id: 'a4',
    type: 'table',
    at: [300, 200],
    colWidths: [50, 50],
    rowHeights: [20, 20],
    cells: [
      ['h1', 'h2'],
      ['v1', ''],
    ],
  },
];

describe('SVG export with annotations', () => {
  const svg = buildExportSvg(compile(EMPTY), { annotations: ANNS });

  it('renders typeless annotations as text (back-compat)', () => {
    expect(svg).toContain('legacy note');
  });

  it('renders the rect with dash, tint and label', () => {
    expect(svg).toMatch(/<rect x="100" y="100" width="120" height="80" fill="black" fill-opacity="0.05"\/>/);
    expect(svg).toMatch(/<rect x="100" y="100" width="120" height="80" fill="none" stroke="black" stroke-width="1" stroke-dasharray="6 4"\/>/);
    expect(svg).toContain('Panel #1');
  });

  it('renders the line with an end arrowhead', () => {
    expect(svg).toMatch(/<polyline points="300,100 400,100" fill="none" stroke="black"/);
    expect(svg).toMatch(/<polygon points="400,100[^"]*" fill="black"\/>/);
  });

  it('renders the table grid and cell texts', () => {
    expect(svg).toMatch(/<rect x="300" y="200" width="100" height="40" fill="none" stroke="black" stroke-width="1"\/>/);
    expect(svg).toContain('>h1</text>');
    expect(svg).toContain('>v1</text>');
  });

  it('includes shape extents in the content bbox', () => {
    // With only a far-right line+table, the viewBox must reach past x=400.
    const solo = buildExportSvg(compile(EMPTY), {
      annotations: [ANNS[2]],
    });
    const vb = solo.match(/viewBox="([-\d. ]+)"/)?.[1].split(' ').map(Number);
    expect(vb).toBeDefined();
    expect(vb![0] + vb![2]).toBeGreaterThanOrEqual(400);
  });
});

describe('DXF export with annotations', () => {
  const dxf = buildExportDxf(compile(EMPTY), { annotations: ANNS });

  it('emits entities for every variant', () => {
    expect(dxf).toContain('legacy note'); // TEXT
    expect(dxf).toContain('Panel #1'); // rect label TEXT
    expect(dxf).toContain('LWPOLYLINE'); // rect/line/table outlines
    expect(dxf).toContain('h1'); // table cell TEXT
  });
});
