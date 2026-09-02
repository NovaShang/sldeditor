/**
 * Element structural labels: multi-line names, and the per-element nudge that
 * lets a user drag the block off the anchor its library entry declares.
 *
 * Both came out of the same week of feedback ("it would be good if the
 * equipment name can be adjusted with new row by pressing enter" and
 * "equipment description should be able to re-arranged /adjusted as text"),
 * and both have to hold on THREE renderers — the canvas, the SVG/PNG export
 * and the DXF export — which is why the placement math lives in one module
 * and why these tests assert against the exporters rather than the helper
 * alone. Rotation/mirror placement and the document font size live in the
 * sibling `element-labels.test.ts`; this file is only the two new knobs.
 *
 * @vitest-environment jsdom
 *
 * (The DXF writer parses each symbol's SVG with `DOMParser`, so anything with
 * an element in it needs a DOM.)
 */

import { describe, expect, it } from 'vitest';
import { compile } from '../../src/compiler';
import { labelLines, nameLines } from '../../src/lib/element-labels';
import { buildExportDxf } from '../../src/lib/export-dxf';
import { buildExportSvg } from '../../src/lib/export-image';
import type { DiagramFile, Element } from '../../src/model';

const breaker = (extra: Partial<Element> = {}): DiagramFile => ({
  version: '1',
  elements: [{ id: 'QF1', kind: 'breaker', ...extra }],
  layout: { QF1: { at: [0, 0] } },
});

/** `<text>` coordinates in export order, for the given label content. */
function svgTextAt(svg: string, content: string): [number, number][] {
  const re = new RegExp(
    `<text x="([-\\d.]+)" y="([-\\d.]+)" text-anchor="[a-z]+">${content}</text>`,
    'g',
  );
  return [...svg.matchAll(re)].map((m) => [Number(m[1]), Number(m[2])]);
}

describe('nameLines', () => {
  it('splits a name on newlines', () => {
    expect(nameLines('QF1\n630A', 'X')).toEqual(['QF1', '630A']);
  });

  it('accepts CRLF and bare CR, which is what a paste can carry', () => {
    expect(nameLines('A\r\nB\rC', 'X')).toEqual(['A', 'B', 'C']);
  });

  it('trims each line and drops blank ones', () => {
    // A trailing Enter is a slip, not a request for a gap.
    expect(nameLines('  QF1  \n\n  630A \n', 'X')).toEqual(['QF1', '630A']);
  });

  it('falls back to the id when nothing is left', () => {
    expect(nameLines(undefined, 'QF1')).toEqual(['QF1']);
    expect(nameLines('   \n  ', 'QF1')).toEqual(['QF1']);
  });

  it('returns no lines at all when there is no id to fall back to', () => {
    expect(nameLines('', '')).toEqual([]);
  });
});

describe('labelLines', () => {
  const lines = (d: DiagramFile, mode: 'id' | 'all') => {
    const re = compile(d).elements.get('QF1')!;
    return labelLines(re, mode);
  };

  it('renders a multi-line name as one line per row', () => {
    expect(lines(breaker({ name: 'QF1\n630A/25kA' }), 'id')).toEqual([
      'QF1',
      '630A/25kA',
    ]);
  });

  it('stacks showOnCanvas params below every name row', () => {
    expect(
      lines(breaker({ name: 'QF1\nMain incomer', params: { In: 630 } }), 'all'),
    ).toEqual(['QF1', 'Main incomer', '630A']);
  });

  it('still falls back to the element id', () => {
    expect(lines(breaker(), 'id')).toEqual(['QF1']);
  });
});

describe('multi-line names in the exporters', () => {
  it('emits one SVG <text> per row, stacked by the line height', () => {
    const svg = buildExportSvg(compile(breaker({ name: 'QF1\n630A' })));
    const [first] = svgTextAt(svg, 'QF1');
    const [second] = svgTextAt(svg, '630A');
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second[0]).toBe(first[0]);
    // LABEL_LINE_HEIGHT at the default font size.
    expect(second[1] - first[1]).toBe(9);
  });

  it('emits one DXF TEXT per row', () => {
    const dxf = buildExportDxf(compile(breaker({ name: 'QF1\n630A' })));
    expect(dxf).toMatch(/\n1\nQF1\n/);
    expect(dxf).toMatch(/\n1\n630A\n/);
  });

});

describe('labelOffset', () => {
  it('shifts the SVG label by exactly the stored delta', () => {
    const base = svgTextAt(buildExportSvg(compile(breaker({ name: 'QF1' }))), 'QF1');
    const moved = svgTextAt(
      buildExportSvg(compile(breaker({ name: 'QF1', labelOffset: [10, -20] }))),
      'QF1',
    );
    expect(moved[0][0] - base[0][0]).toBe(10);
    expect(moved[0][1] - base[0][1]).toBe(-20);
  });

  it('moves every row of a multi-line block together', () => {
    const d = breaker({ name: 'QF1\n630A', labelOffset: [10, -20] });
    const svg = buildExportSvg(compile(d));
    const [first] = svgTextAt(svg, 'QF1');
    const [second] = svgTextAt(svg, '630A');
    expect(second[0]).toBe(first[0]);
    expect(second[1] - first[1]).toBe(9);
  });

  it('shifts the DXF label too — the three renderers must agree', () => {
    const at = (dxf: string) => {
      const lines = dxf.split('\n').map((l) => l.trim());
      const i = lines.indexOf('QF1');
      // Our writer emits 10/<x> 20/<y> before the string (group 1).
      const x = lines.lastIndexOf('10', i);
      const y = lines.lastIndexOf('20', i);
      return [Number(lines[x + 1]), Number(lines[y + 1])];
    };
    const base = at(buildExportDxf(compile(breaker({ name: 'QF1' }))));
    const moved = at(
      buildExportDxf(compile(breaker({ name: 'QF1', labelOffset: [10, -20] }))),
    );
    expect(moved[0] - base[0]).toBe(10);
    // DXF is Y-up, so a label dragged UP on screen gains Y here.
    expect(moved[1] - base[1]).toBe(20);
  });

  it('leaves a diagram with no offset byte-identical', () => {
    const before = buildExportSvg(compile(breaker({ name: 'QF1' })));
    const after = buildExportSvg(
      compile(breaker({ name: 'QF1', labelOffset: undefined })),
    );
    expect(after).toBe(before);
  });
});
