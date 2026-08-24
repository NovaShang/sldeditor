/**
 * Colour across the export paths, and the promise that pays for it: a diagram
 * with no colour fields must export byte-for-byte as it did before colours
 * existed.
 *
 * That guarantee is why `default` resolves to the literal string `black` in
 * SVG and to "no group 62" in DXF rather than to a nice hex — every user's
 * existing drawing is the regression suite for this feature.
 *
 * @vitest-environment jsdom
 *
 * (jsdom because the DXF writer parses each element symbol's SVG with
 * `DOMParser`, and a coloured symbol is precisely what these tests check.)
 */

import { describe, expect, it } from 'vitest';
import { compile } from '../../src/compiler';
import { buildExportSvg } from '../../src/lib/export-image';
import { buildExportDxf } from '../../src/lib/export-dxf';
import { NAMED_COLORS } from '../../src/lib/colors';
import type { Annotation, DiagramFile } from '../../src/model';

/** Everything after the ENTITIES header — the drawn objects, not the tables. */
function entitiesSection(dxf: string): string {
  const i = dxf.indexOf('ENTITIES');
  expect(i).toBeGreaterThan(-1);
  return dxf.slice(i);
}

/** A diagram exercising every drawable: symbol, bus, wire and annotations. */
function diagram(colored: boolean): {
  file: DiagramFile;
  annotations: Annotation[];
} {
  const c = <T,>(v: T) => (colored ? v : undefined);
  const file: DiagramFile = {
    version: '1',
    elements: [{ id: 'QF1', kind: 'breaker', color: c('red' as const) }],
    buses: [
      {
        id: 'B1',
        layout: { at: [0, 0], span: 200 },
        color: c('blue' as const),
      },
    ],
    // The label matters: a wire label follows its wire's ink, so the fixture
    // has to carry one or the byte-identical guarantee never exercises that
    // path.
    wires: [
      { id: 'w1', ends: ['QF1.t1', 'B1'], label: 'L1', color: c('green' as const) },
    ],
    layout: { QF1: { at: [0, 100] } },
  };
  const annotations: Annotation[] = [
    { id: 'a1', at: [0, 300], text: 'note', color: c('amber' as const) },
    {
      id: 'a2',
      type: 'rect',
      at: [200, 300],
      size: [80, 40],
      color: c('gray' as const),
    },
    {
      id: 'a3',
      type: 'ellipse',
      at: [300, 300],
      size: [80, 40],
      color: c('red' as const),
    },
    {
      id: 'a4',
      type: 'line',
      at: [400, 300],
      points: [
        [0, 0],
        [50, 0],
      ],
      color: c('blue' as const),
      arrow: 'end',
    },
  ];
  return { file, annotations };
}

describe('an uncoloured diagram is untouched by this feature', () => {
  it('emits no hex ink in SVG', () => {
    const { file, annotations } = diagram(false);
    const svg = buildExportSvg(compile(file), { annotations });
    // Only the background may be a hex value; all ink stays the literal
    // `black` these exporters have always written.
    const inks = [...svg.matchAll(/(?:stroke|fill)="(#[0-9a-f]{6})"/gi)].map(
      (m) => m[1].toLowerCase(),
    );
    expect(inks.filter((v) => v !== '#ffffff')).toEqual([]);
    expect(svg).toContain('stroke="black"');
  });

  it('writes no group 62 colour override in DXF', () => {
    const { file, annotations } = diagram(false);
    const dxf = buildExportDxf(compile(file), { annotations });
    // Only look at ENTITIES: the LAYER table legitimately carries its own
    // group 62 (that is how a layer declares its colour) and always has.
    // Absence here means every entity inherits its layer, exactly as before.
    expect(entitiesSection(dxf)).not.toMatch(/^\s*62\s*$/m);
  });
});

describe('a coloured diagram carries its ink into both formats', () => {
  it('resolves every object to its light-theme hex in SVG', () => {
    const { file, annotations } = diagram(true);
    const svg = buildExportSvg(compile(file), { annotations });
    for (const name of ['red', 'blue', 'green', 'amber', 'gray'] as const) {
      expect(svg.toLowerCase()).toContain(NAMED_COLORS[name].light.toLowerCase());
    }
  });

  it('recolours the inlined library symbol, not just the wires', () => {
    const { file, annotations } = diagram(true);
    const svg = buildExportSvg(compile(file), { annotations });
    // The breaker symbol ships literal black strokes; a coloured element must
    // have had them substituted the way styles.css does on canvas.
    const symbol = svg.slice(svg.indexOf('id="QF1"'));
    const body = symbol.slice(0, symbol.indexOf('</g>'));
    expect(body).toContain(NAMED_COLORS.red.light);
    expect(body).not.toContain('stroke="black"');
  });

  it('writes an ACI index per coloured entity in DXF', () => {
    const { file, annotations } = diagram(true);
    const entities = entitiesSection(buildExportDxf(compile(file), { annotations }));
    expect(entities).toMatch(/^\s*62\s*$/m);
    for (const name of ['red', 'blue', 'green', 'amber', 'gray'] as const) {
      expect(entities).toMatch(
        new RegExp(`^\\s*62\\s*\\n\\s*${NAMED_COLORS[name].aci}\\s*$`, 'm'),
      );
    }
  });
});

describe('stroke style and weight', () => {
  const shaped = (
    stroke: 'solid' | 'dashed' | 'dotted',
    strokeWidth: 1 | 2 | 3,
  ): Annotation[] => [
    { id: 's1', type: 'line', at: [0, 0], points: [[0, 0], [40, 0]], stroke, strokeWidth },
  ];

  it('emits a dot pattern distinct from the dash pattern', () => {
    const dashed = buildExportSvg(compile({ version: '1', elements: [] }), {
      annotations: shaped('dashed', 1),
    });
    const dotted = buildExportSvg(compile({ version: '1', elements: [] }), {
      annotations: shaped('dotted', 1),
    });
    expect(dashed).toContain('stroke-dasharray');
    expect(dotted).toContain('stroke-dasharray');
    expect(dashed).not.toBe(dotted);
  });

  it('omits stroke-dasharray entirely for a solid stroke', () => {
    const svg = buildExportSvg(compile({ version: '1', elements: [] }), {
      annotations: shaped('solid', 1),
    });
    expect(svg).not.toContain('stroke-dasharray');
  });

  it('carries the chosen weight', () => {
    const svg = buildExportSvg(compile({ version: '1', elements: [] }), {
      annotations: shaped('solid', 3),
    });
    expect(svg).toContain('stroke-width="3"');
  });
});

/**
 * Labels split two ways on purpose, so a change to one must not quietly drag
 * the other with it.
 *
 * An element's structural label is the device's IDENTITY (QF1, 630 A) and is
 * orthogonal to whatever the colour is coding — voltage level, new-vs-existing
 * — which is why electrical CAD keeps device tags neutral while the conductors
 * carry the colour. A wire label is a phase designation, and phase
 * colour-coding is the canonical reason to colour a conductor at all: there
 * the text is what the colour is saying.
 */
describe('wire labels take the wire ink, element labels do not', () => {
  const wireLabelText = (svg: string) =>
    svg.match(/<text[^>]*>L1<\/text>/)?.[0] ?? '';
  const elementLabelText = (svg: string) =>
    svg.match(/<text[^>]*>QF1<\/text>/)?.[0] ?? '';

  it('paints a coloured wire label with the wire hex', () => {
    const { file, annotations } = diagram(true);
    const svg = buildExportSvg(compile(file), { annotations });
    expect(wireLabelText(svg)).toContain(
      `fill="${NAMED_COLORS.green.light}"`,
    );
  });

  it('leaves the element label neutral even when the element is coloured', () => {
    const { file, annotations } = diagram(true);
    const svg = buildExportSvg(compile(file), { annotations });
    // QF1 is red; its tag must inherit the group's black, carrying no fill.
    expect(elementLabelText(svg)).not.toContain('fill=');
  });

  it('adds no fill at all when the wire is uncoloured', () => {
    const { file, annotations } = diagram(false);
    const svg = buildExportSvg(compile(file), { annotations });
    expect(wireLabelText(svg)).not.toContain('fill=');
  });

  it('carries the wire ink into the DXF label as group 62', () => {
    const { file, annotations } = diagram(true);
    const dxf = buildExportDxf(compile(file), { annotations });
    const ents = entitiesSection(dxf);
    // The label is a TEXT entity; find it and read the colour that precedes it.
    const i = ents.indexOf('L1');
    expect(i).toBeGreaterThan(-1);
    const before = ents.slice(0, i);
    const lastColor = [...before.matchAll(/^\s*62\s*\n\s*(\d+)\s*$/gm)].pop();
    expect(lastColor?.[1]).toBe(String(NAMED_COLORS.green.aci));
  });
});
