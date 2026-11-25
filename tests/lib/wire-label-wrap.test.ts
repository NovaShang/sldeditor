/**
 * Long cable strings on parallel feeders.
 *
 * A vertical run's label flows to the right of its wire. On a panel with
 * feeders 90 units apart (the auto-layout pitch), a cable spec such as
 * "4×16 mm² Cu XLPE/SWA/PVC" ran straight across the next feeder and into
 * that feeder's own label at the same height, leaving both unreadable — in
 * the canvas, the SVG/PNG/PDF export and the DXF alike.
 *
 * The fix wraps such a label at word boundaries into the gap it actually has,
 * and ONLY when it would reach the neighbouring wire: every label that
 * already fit keeps the single line (and the exact bytes) it always had.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';
import { compile } from '../../src/compiler';
import { LABEL_FONT_SIZE, labelBlockWidth } from '../../src/lib/element-labels';
import {
  WIRE_LABEL_OFFSET,
  placeWireLabel,
  placeWireLabels,
} from '../../src/lib/wire-labels';
import { buildExportSvg } from '../../src/lib/export-image';
import { buildExportDxf } from '../../src/lib/export-dxf';
import type { DiagramFile, WireRender } from '../../src';

const LONG = '4×16 mm² Cu XLPE/SWA/PVC';

const vrun = (id: string, x: number, label?: string, y1 = 0, y2 = 200): WireRender => ({
  wireId: id,
  path: [
    [x, y1],
    [x, y2],
  ],
  ...(label ? { label } : {}),
});

const asMap = (rs: WireRender[]) => new Map(rs.map((r) => [r.wireId, r]));

describe('placeWireLabels', () => {
  it('keeps a long label on one line when nothing is in its way', () => {
    const out = placeWireLabels(asMap([vrun('a', 0, LONG)]), LABEL_FONT_SIZE);
    const single = placeWireLabel([[0, 0], [0, 200]], LABEL_FONT_SIZE)!;
    expect(out.get('a')).toMatchObject({ ...single, lines: [LONG] });
  });

  it('keeps a label that fits beside its neighbour on one line', () => {
    const out = placeWireLabels(
      asMap([vrun('a', 0, '1×70 mm² Cu SWA'), vrun('b', 90, 'x')]),
      LABEL_FONT_SIZE,
    );
    expect(out.get('a')!.lines).toEqual(['1×70 mm² Cu SWA']);
  });

  it('wraps a label that would run into the next feeder, at word boundaries', () => {
    const out = placeWireLabels(
      asMap([vrun('a', 0, LONG), vrun('b', 90, LONG)]),
      LABEL_FONT_SIZE,
    );
    const a = out.get('a')!;
    expect(a.lines.length).toBeGreaterThan(1);
    expect(a.lines.join(' ')).toBe(LONG);
    // The widest line now stops short of the neighbouring wire.
    expect(WIRE_LABEL_OFFSET + labelBlockWidth(a.lines, LABEL_FONT_SIZE)).toBeLessThan(90);
    // The block stays centred on the run's midpoint.
    const lh = a.lineHeight;
    const first = a.world[1];
    const last = first + (a.lines.length - 1) * lh;
    expect((first + last) / 2).toBeCloseTo(100 + LABEL_FONT_SIZE / 3);
  });

  it('ignores a neighbour that does not reach the label height', () => {
    const out = placeWireLabels(
      asMap([vrun('a', 0, LONG), vrun('b', 60, undefined, 0, 40)]),
      LABEL_FONT_SIZE,
    );
    expect(out.get('a')!.lines).toEqual([LONG]);
  });
});

/** Four feeders off a bus at the auto-layout pitch, every one with a long spec. */
const PANEL: DiagramFile = {
  version: '1',
  elements: [],
  junctions: [0, 1, 2, 3].flatMap((i) => [
    { id: `T${i}`, layout: { at: [i * 90, 0] as [number, number] } },
    { id: `B${i}`, layout: { at: [i * 90, 200] as [number, number] } },
  ]),
  wires: [0, 1, 2, 3].map((i) => ({ id: `w${i}`, ends: [`T${i}`, `B${i}`], label: LONG })),
};

describe('exports', () => {
  it('SVG writes a wrapped label as stacked lines', () => {
    const svg = buildExportSvg(compile(PANEL));
    // The three feeders with a neighbour wrap; the last one has room.
    expect(svg.split(`>${LONG}<`).length - 1).toBe(1);
    expect(svg.split('>XLPE/SWA/PVC<').length - 1).toBe(3);
  });

  it('DXF writes one TEXT per wrapped line', () => {
    const dxf = buildExportDxf(compile(PANEL));
    const texts = dxf.split('\n').map((l) => l.trim());
    expect(texts.filter((l) => l.endsWith('XLPE/SWA/PVC') && l !== 'XLPE/SWA/PVC').length).toBe(1);
    expect(texts.filter((l) => l === 'XLPE/SWA/PVC').length).toBe(3);
  });
});
