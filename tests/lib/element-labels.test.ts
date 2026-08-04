/**
 * Label placement must be rotation/mirror-aware: the anchor point rotates
 * with the symbol (anchorWorld), so the *alignment* has to follow, or a
 * right-side `start` label runs back across the symbol body at rot 180 and
 * across the wire at rot 90/270 (W26 expert review: "labels strike through
 * rot-180 inverters", "rot-90 bus-tie breaker renders garbled").
 */

import { describe, expect, it } from 'vitest';
import { LIBRARY, compile } from '../../src/compiler';
import type { ResolvedPlacement } from '../../src/compiler';
import {
  LABEL_FONT_SIZE,
  LABEL_FONT_SIZE_MAX,
  LABEL_FONT_SIZE_MIN,
  LABEL_LINE_HEIGHT,
  fallbackAnchor,
  labelLineHeight,
  placeLabel,
  resolveLabelFontSize,
} from '../../src/lib/element-labels';
import { buildExportSvg } from '../../src/lib/export-image';
import type { DiagramFile } from '../../src/model';

const breaker = LIBRARY.get('breaker');
if (!breaker) throw new Error('breaker kind missing from library');
const anchor = breaker.label;
if (!anchor) throw new Error('breaker library entry has no label anchor');

const place = (
  rot: ResolvedPlacement['rot'],
  mirror = false,
): ResolvedPlacement => ({ at: [100, 200], rot, mirror });

describe('placeLabel', () => {
  it('rot 0 reproduces the declared anchor exactly', () => {
    const p = placeLabel(anchor, breaker, place(0), 1);
    expect(p.world).toEqual([100 + anchor.x, 200 + anchor.y]);
    expect(p.textAnchor).toBe('start');
    expect(p.dy).toBe(0);
  });

  it('rot 180 flips a right-side label to the left, text flowing away', () => {
    const p = placeLabel(anchor, breaker, place(180), 1);
    expect(p.world).toEqual([100 - anchor.x, 200 - anchor.y]);
    expect(p.textAnchor).toBe('end');
    expect(p.dy).toBe(0);
  });

  it('mirror flips a right-side label to the left', () => {
    const p = placeLabel(anchor, breaker, place(0, true), 1);
    expect(p.textAnchor).toBe('end');
  });

  it('rot 90 moves a right-side label below the symbol, centered', () => {
    const p = placeLabel(anchor, breaker, place(90), 1);
    expect(p.textAnchor).toBe('middle');
    // First baseline drops clear of the anchor point on the symbol edge.
    expect(p.dy).toBe(LABEL_FONT_SIZE);
    expect(p.world[1]).toBeGreaterThan(200);
  });

  it('rot 270 moves a right-side label above the symbol, stacked upward', () => {
    const p = placeLabel(anchor, breaker, place(270), 2);
    expect(p.textAnchor).toBe('middle');
    // Two lines: block shifts up one line-height so it ends at the anchor.
    expect(p.dy).toBe(-LABEL_LINE_HEIGHT);
    expect(p.world[1]).toBeLessThan(200);
  });
});

describe('export SVG label alignment', () => {
  it('rot-180 inverter label is end-anchored (beside, not through, the symbol)', () => {
    const d: DiagramFile = {
      version: '1',
      elements: [{ id: 'INV1', kind: 'inverter', name: 'Inverter 1' }],
      layout: { INV1: { at: [280, 300], rot: 180 } },
      wires: [],
    };
    const svg = buildExportSvg(compile(d));
    expect(svg).toMatch(/<text[^>]*text-anchor="end"[^>]*>Inverter 1<\/text>/);
  });

  it('rot-90 breaker label is centered below the symbol', () => {
    const d: DiagramFile = {
      version: '1',
      elements: [{ id: 'QFT', kind: 'breaker', name: 'Bus Tie' }],
      layout: { QFT: { at: [800, 520], rot: 90 } },
      wires: [],
    };
    const svg = buildExportSvg(compile(d));
    const m = svg.match(
      /<text x="([-\d.]+)" y="([-\d.]+)" text-anchor="middle">Bus Tie<\/text>/,
    );
    expect(m).not.toBeNull();
    // Below the placement row (y > 520), horizontally near the symbol centre.
    expect(Number(m![2])).toBeGreaterThan(520);
  });
});

/**
 * `DiagramMeta.labelFontSize` exists because the only sizing knob the product
 * shipped was the free-text annotation picker — users were dropping floating
 * text over their diagram just to get type readable on an A4 print. It is
 * document-level, defaults to the historical 7, and MUST reach the canvas and
 * both exporters identically (an export path that silently disagrees with the
 * canvas is exactly the bug class this module was created to prevent).
 */
describe('label font size resolution', () => {
  it('falls back to the historical default when unset', () => {
    expect(resolveLabelFontSize(undefined)).toBe(LABEL_FONT_SIZE);
    expect(LABEL_FONT_SIZE).toBe(7);
  });

  it('clamps hand-edited JSON instead of trusting it', () => {
    expect(resolveLabelFontSize(0)).toBe(LABEL_FONT_SIZE_MIN);
    expect(resolveLabelFontSize(-40)).toBe(LABEL_FONT_SIZE_MIN);
    expect(resolveLabelFontSize(9999)).toBe(LABEL_FONT_SIZE_MAX);
    expect(resolveLabelFontSize(Number.NaN)).toBe(LABEL_FONT_SIZE);
    // A string smuggled in through untyped JSON.
    expect(resolveLabelFontSize('12' as unknown as number)).toBe(LABEL_FONT_SIZE);
  });

  it('scales the line step with the font, exact at the default', () => {
    expect(labelLineHeight()).toBe(LABEL_LINE_HEIGHT);
    expect(labelLineHeight(LABEL_FONT_SIZE)).toBe(LABEL_LINE_HEIGHT);
    // 9/7 preserved: doubling the font doubles the step.
    expect(labelLineHeight(14)).toBe(18);
    // Every supported size keeps the step clear of the glyph height, so
    // stacked lines can never collide.
    for (let fs = LABEL_FONT_SIZE_MIN; fs <= LABEL_FONT_SIZE_MAX; fs++) {
      expect(labelLineHeight(fs)).toBeGreaterThan(fs);
    }
  });

  it('scales the baseline nudge and the upward stack', () => {
    expect(fallbackAnchor(breaker, 21).y - fallbackAnchor(breaker, 0).y).toBe(7);
    // rot 270 stacks the block upward by whole line heights.
    expect(placeLabel(anchor, breaker, place(270), 2, 14).dy).toBe(-18);
    expect(placeLabel(anchor, breaker, place(270), 2).dy).toBe(-LABEL_LINE_HEIGHT);
  });
});

describe('export honors the document label size', () => {
  // Three lines: name + two showOnCanvas params. The breaker declares an
  // explicit label anchor, so the anchor point is size-independent and the
  // baselines isolate the line-height behavior.
  const diagram: DiagramFile = {
    version: '1',
    elements: [
      { id: 'QF1', kind: 'breaker', name: 'QF1', params: { In: 40, poles: 4 } },
    ],
    layout: { QF1: { at: [100, 100] } },
    wires: [],
  };
  const model = compile(diagram);
  const baselines = (svg: string): number[] =>
    [...svg.matchAll(/<text x="106" y="([-\d.]+)" text-anchor="start">/g)].map((m) =>
      Number(m[1]),
    );

  it('renders the pre-setting output when the field is absent', () => {
    const svg = buildExportSvg(model);
    expect(svg).toContain('font-size="7"');
    // Anchor (6,-2) + placement (100,100); lines step by LABEL_LINE_HEIGHT.
    expect(svg).toContain('<text x="106" y="98" text-anchor="start">QF1</text>');
    expect(svg).toContain('<text x="106" y="107" text-anchor="start">40A</text>');
    expect(svg).toContain('<text x="106" y="116" text-anchor="start">4P</text>');
    // Absent and explicit-default must be byte-identical, viewBox included.
    expect(svg).toBe(buildExportSvg(model, { labelFontSize: LABEL_FONT_SIZE }));
  });

  it('carries a non-default size into the SVG', () => {
    const svg = buildExportSvg(model, { labelFontSize: 14 });
    expect(svg).toContain('font-size="14"');
    expect(svg).not.toContain('font-size="7"');
    expect(baselines(svg)).toEqual([98, 116, 134]);
  });

  it('keeps enlarged multi-line labels from overlapping', () => {
    for (const fs of [LABEL_FONT_SIZE_MIN, 10, 16, LABEL_FONT_SIZE_MAX]) {
      const rows = baselines(buildExportSvg(model, { labelFontSize: fs }));
      expect(rows).toHaveLength(3);
      for (let i = 1; i < rows.length; i++) {
        // Consecutive baselines must clear the glyph height, or a descender
        // of line i lands on the cap height of line i+1.
        expect(rows[i] - rows[i - 1]).toBeGreaterThan(fs);
      }
    }
  });

  it('grows the content bbox so big labels are not cropped', () => {
    const vb = (svg: string) =>
      svg.match(/viewBox="([-\d. ]+)"/)![1].split(' ').map(Number);
    const small = vb(buildExportSvg(model));
    const big = vb(buildExportSvg(model, { labelFontSize: LABEL_FONT_SIZE_MAX }));
    // Wider (longer text run) and taller (three tall lines).
    expect(big[2]).toBeGreaterThan(small[2]);
    expect(big[3]).toBeGreaterThan(small[3]);
  });

  it('clamps an out-of-range size rather than emitting it', () => {
    expect(buildExportSvg(model, { labelFontSize: 500 })).toContain(
      `font-size="${LABEL_FONT_SIZE_MAX}"`,
    );
    expect(buildExportSvg(model, { labelFontSize: 1 })).toContain(
      `font-size="${LABEL_FONT_SIZE_MIN}"`,
    );
  });

  // DXF is covered in wire-labels.test.ts: `buildExportDxf` needs a DOMParser
  // to rasterize symbol artwork, which the node test env lacks, so the
  // element-free wire-label diagram is the only DXF path testable here.
});

describe('terminal-number glyphs (pin digits)', () => {
  it('are split out of the breaker symbol artwork', () => {
    expect(breaker.svg).not.toContain('<text');
    expect(breaker.terminalLabelsSvg).toContain('>1</text>');
    expect(breaker.terminalLabelsSvg).toContain('>2</text>');
  });

  it('never land in the export SVG', () => {
    const d: DiagramFile = {
      version: '1',
      elements: [{ id: 'QF1', kind: 'breaker' }],
      layout: { QF1: { at: [0, 0] } },
      wires: [],
    };
    const svg = buildExportSvg(compile(d));
    // Symbol-embedded texts carry the QET font stack; labels don't.
    expect(svg).not.toContain('Liberation Sans');
  });

  it('machine glyphs like the motor "M 3~" stay in the symbol artwork', () => {
    const motor = LIBRARY.get('async-motor');
    expect(motor?.svg).toContain('>M</text>');
    expect(motor?.svg).toContain('>3</text>');
    expect(motor?.terminalLabelsSvg).toBeUndefined();
  });
});
