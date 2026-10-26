/**
 * Sheets in the exporters. What fails silently here is the page itself: a
 * frame missing from the file, a page cropped with padding (so the PDF page
 * no longer maps edge-to-edge onto paper), or a 0.13 mm wire on an enlarged
 * sheet — every one of them still produces a valid file.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';
import { compile } from '../../src/compiler';
import { buildExportSvg } from '../../src/lib/export-image';
import { buildExportDxf } from '../../src/lib/export-dxf';
import {
  sheetExportOptions,
  sheetExportRegion,
  sheetMinStroke,
} from '../../src/lib/export-sheets';
import { MM_PER_UNIT, sheetRect, type Sheet } from '../../src/model/sheet';
import type { Annotation, DiagramFile } from '../../src/model';

const S1: Sheet = { id: 'S1', paper: 'a4', orientation: 'landscape', at: [0, 0], title: 'Main board' };
const S2: Sheet = { id: 'S2', paper: 'a3', orientation: 'portrait', at: [2000, 0], scale: 2, number: 'E-002' };

const diagram: DiagramFile = {
  version: '1',
  elements: [
    { id: 'QF1', kind: 'breaker' },
    { id: 'QF2', kind: 'breaker' },
    { id: 'QF9', kind: 'breaker' },
  ],
  layout: { QF1: { at: [300, 200] }, QF2: { at: [300, 400] }, QF9: { at: [2600, 600] } },
  wires: [{ id: 'w1', ends: ['QF1.t2', 'QF2.t1'] }],
};
const ANNS: Annotation[] = [
  { id: 'n1', type: 'text', at: [100, 100], text: 'NOTE ON SHEET 1' },
  { id: 'n2', type: 'text', at: [2200, 100], text: 'NOTE ON SHEET 2' },
  { id: 'r1', type: 'rect', at: [50, 50], size: [100, 60], strokeWidth: 0.5 } as Annotation,
];

const opts = { sheets: [S1, S2], titleBlock: { project: 'Plant 7' }, annotations: ANNS };

function strokeWidths(svg: string): number[] {
  return svg
    .split('\n')
    .filter((l) => !l.includes('paint-order')) // label haloes: not ink
    .flatMap((l) => [...l.matchAll(/stroke-width="([0-9.]+)"/g)].map((m) => Number(m[1])));
}

describe('sheet export helpers', () => {
  it('a sheet exports as exactly its outer border', () => {
    expect(sheetExportRegion(S2)).toEqual(sheetRect(S2));
  });

  it('the stroke floor is 0.25 mm on paper, i.e. scales with the frame', () => {
    expect(sheetMinStroke(S1) * MM_PER_UNIT).toBeCloseTo(0.25, 9);
    expect(sheetMinStroke(S2)).toBeCloseTo(2 * sheetMinStroke(S1), 9);
    expect(sheetExportOptions(S2)).toEqual({ region: sheetRect(S2), minStrokeWidth: sheetMinStroke(S2) });
  });
});

describe('buildExportSvg with sheets', () => {
  it('draws every frame and title block, beneath the drawing', () => {
    const svg = buildExportSvg(compile(diagram), opts);
    expect(svg).toContain('>Main board<');
    expect(svg).toContain('>E-002<');
    // Shared fields appear on every sheet.
    expect(svg.match(/>Plant 7</g)).toHaveLength(2);
    // Frames come before the wires group, so the drawing paints over them.
    const frame = svg.indexOf(`width="${Math.round(sheetRect(S1).w * 1000) / 1000}"`);
    expect(frame).toBeGreaterThan(0);
    expect(frame).toBeLessThan(svg.indexOf('<polyline'));
  });

  it('widens the whole-canvas bounds to include every sheet', () => {
    const svg = buildExportSvg(compile(diagram), opts);
    const [x, y, w, h] = /viewBox="([^"]+)"/.exec(svg)![1].split(' ').map(Number);
    const r2 = sheetRect(S2);
    expect(x).toBeLessThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(0);
    expect(x + w).toBeGreaterThanOrEqual(r2.x + r2.w);
    expect(y + h).toBeGreaterThanOrEqual(r2.y + r2.h);
  });

  it('crops to a region exactly, with matching width/height', () => {
    const r = sheetExportRegion(S2);
    const svg = buildExportSvg(compile(diagram), { ...opts, region: r });
    expect(svg).toContain(`viewBox="${r.x} ${r.y} ${r.w} ${r.h}" width="${r.w}" height="${r.h}"`);
    expect(svg).toContain(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#FFFFFF"/>`);
  });

  it('keeps every ink stroke at or above the floor', () => {
    const floor = sheetMinStroke(S2); // ≈1.89 units: above the 1-unit wires and symbols
    const svg = buildExportSvg(compile(diagram), { ...opts, minStrokeWidth: floor });
    const widths = strokeWidths(svg);
    expect(widths.length).toBeGreaterThan(5);
    for (const w of widths) expect(w).toBeGreaterThanOrEqual(floor);
    // Strokes already thicker than the floor are left alone (buses are 3).
    expect(buildExportSvg(compile({ ...diagram, buses: [{ id: 'B1', layout: { at: [0, 0], span: 100 } }] } as DiagramFile), { minStrokeWidth: floor })).toContain('stroke-width="3"');
    // Label haloes are not ink and keep their width.
    expect(svg).toMatch(/paint-order="stroke"[^>]*stroke-width="2"/);
  });

  it('floors a scaled symbol in world units, after its scale compensation', () => {
    const d: DiagramFile = { version: '1', elements: [{ id: 'QF1', kind: 'breaker' }], layout: { QF1: { at: [0, 0], scale: 2 } } };
    const floor = 3;
    const svg = buildExportSvg(compile(d), { minStrokeWidth: floor });
    // Inside a scale(2) group the local width must be 1.5 to print at 3.
    const sym = svg.slice(svg.indexOf('<g id="QF1"'));
    const local = [...sym.slice(0, sym.indexOf('</g>')).matchAll(/stroke-width="([0-9.]+)"/g)].map((m) => Number(m[1]));
    expect(local.length).toBeGreaterThan(0);
    for (const w of local) expect(w * 2).toBeGreaterThanOrEqual(floor);
  });
});

describe('buildExportDxf with sheets', () => {
  const layers = (dxf: string) => {
    const lines = dxf.split('\n');
    const out: Record<string, number> = {};
    for (let i = 0; i + 1 < lines.length; i += 2) if (lines[i] === '8') out[lines[i + 1]] = (out[lines[i + 1]] ?? 0) + 1;
    return out;
  };

  it('draws sheets on their own layer, declared only when there are sheets', () => {
    const plain = buildExportDxf(compile(diagram), {});
    expect(plain).not.toContain('SHEETS');
    const dxf = buildExportDxf(compile(diagram), opts);
    expect(layers(dxf).SHEETS).toBeGreaterThan(10);
    expect(dxf).toContain('\nMain board\n');
    expect(dxf).toContain('\nE-002\n');
  });

  it('a region keeps what lies on that sheet and its frame, nothing else', () => {
    const dxf = buildExportDxf(compile(diagram), { ...opts, region: sheetExportRegion(S1) });
    expect(dxf).toContain('\nMain board\n');
    expect(dxf).not.toContain('\nE-002\n'); // the other sheet's title block
    expect(dxf).toContain('\nNOTE ON SHEET 1\n');
    expect(dxf).not.toContain('\nNOTE ON SHEET 2\n');
    expect(dxf).toContain('\nQF1\n');
    expect(dxf).not.toContain('\nQF9\n'); // the element's label goes with its symbol
    // The full drawing has more symbol geometry than sheet 1 alone.
    const all = buildExportDxf(compile(diagram), opts);
    expect(layers(dxf).ELEMENTS).toBeLessThan(layers(all).ELEMENTS);
    expect(layers(dxf).WIRES).toBe(layers(all).WIRES); // w1 is on sheet 1
  });
});

describe('off-page connector references in exports', () => {
  // Two connectors named "L1" on different sheets: each label says where the
  // other end is, in every format, exactly as the canvas does.
  const d: DiagramFile = {
    version: '1',
    elements: [
      { id: 'X1', kind: 'continuation-out', name: 'L1' },
      { id: 'X2', kind: 'continuation-in', name: 'L1' },
    ],
    layout: { X1: { at: [900, 300] }, X2: { at: [2200, 300] } },
  };
  const sheets = [S1, S2];

  it('appears in SVG and DXF when the drawing has sheets', () => {
    const svg = buildExportSvg(compile(d), { sheets });
    expect(svg).toContain('→ 2/2');
    expect(svg).toContain('→ 1/2');
    const dxf = buildExportDxf(compile(d), { sheets });
    expect(dxf).toContain('→ 2/2');
  });

  it('is absent without sheets', () => {
    expect(buildExportSvg(compile(d), {})).not.toContain('→');
    expect(buildExportDxf(compile(d), {})).not.toContain('→');
  });
});
