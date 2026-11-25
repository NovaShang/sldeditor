/**
 * Text inside a symbol's own SVG: readable when the symbol is mirrored, and
 * painted so it survives print (PDF goes through the SVG export).
 *
 * @vitest-environment jsdom
 *
 * (jsdom for the DXF exporter's `DOMParser`, and to measure where the
 * rewritten SVG actually puts things.)
 */

import { describe, expect, it } from 'vitest';
import {
  normalizeSymbolTextPaint,
  uprightSymbolText,
  SYMBOL_TEXT_DEFAULT_FONT_SIZE,
} from '../../src/lib/symbol-text';
import { compile } from '../../src/compiler';
import { buildExportSvg } from '../../src/lib/export-image';
import { buildExportDxf } from '../../src/lib/export-dxf';
import type { DiagramFile, LibraryEntry } from '../../src/model';

/** An RCD-like custom symbol whose whole drawing sits in a stroke-only group. */
const rcd: LibraryEntry = {
  id: 'custom:rcd-light',
  name: 'RCD (light point)',
  category: 'protection',
  viewBox: '-20 -30 40 60',
  width: 40,
  height: 60,
  svg:
    '<g stroke="black" fill="none" stroke-width="1">' +
    '<rect x="-15" y="-20" width="30" height="40"/>' +
    '<text x="-8" y="4">IΔn</text>' +
    '</g>',
  terminals: [
    { id: 't1', x: 0, y: -28, orientation: 'n' },
    { id: 't2', x: 0, y: 28, orientation: 's' },
  ],
};

const file = (mirror: boolean): DiagramFile => ({
  version: '1',
  customKinds: [rcd],
  elements: [{ id: 'RCD1', kind: 'custom:rcd-light' }],
  layout: { RCD1: { at: [100, 100], ...(mirror ? { mirror: true } : {}) } },
});

/** Group-code → value pairs of the first TEXT entity on the ELEMENTS layer. */
function elementText(dxf: string): Map<number, string> {
  const lines = dxf.split('\n');
  for (let i = 0; i + 1 < lines.length; i += 2) {
    if (lines[i].trim() !== '0' || lines[i + 1] !== 'TEXT') continue;
    const codes = new Map<number, string>();
    for (let j = i + 2; j + 1 < lines.length && lines[j].trim() !== '0'; j += 2) {
      codes.set(Number(lines[j]), lines[j + 1]);
    }
    if (codes.get(8) === 'ELEMENTS') return codes;
  }
  throw new Error('no symbol TEXT entity');
}

/** The `<text>` opening tags of an SVG string. */
const textTags = (svg: string) => [...svg.matchAll(/<text\b[^>]*>/g)].map((m) => m[0]);

/**
 * Net horizontal scale applied to the glyphs of the first `<text>` in an
 * exported SVG: the product of every `scale(sx …)` between the root and the
 * text. Negative means the glyphs render backwards.
 */
function glyphXScale(svg: string): number {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const text = doc.querySelector('text');
  expect(text).not.toBeNull();
  let sign = 1;
  for (let el: Element | null = text; el; el = el.parentElement) {
    const t = el.getAttribute('transform') ?? '';
    for (const m of t.matchAll(/scale\(\s*(-?[\d.]+)/g)) sign *= Math.sign(Number(m[1]));
  }
  return sign;
}

describe('mirrored symbol text', () => {
  it('reproduces the bug without the fix: the mirror flips the glyphs', () => {
    // Sanity check on the measuring stick: the raw fragment under a
    // mirrored placement has exactly one negative scale above its text.
    const raw = `<g transform="scale(-1 1)">${rcd.svg}</g>`;
    expect(glyphXScale(`<svg xmlns="http://www.w3.org/2000/svg">${raw}</svg>`)).toBe(-1);
  });

  it('SVG export of a mirrored custom symbol keeps its text readable', () => {
    const svg = buildExportSvg(compile(file(true)));
    expect(glyphXScale(svg)).toBe(1);
  });

  it('an unmirrored symbol is untouched', () => {
    expect(glyphXScale(buildExportSvg(compile(file(false))))).toBe(1);
    expect(uprightSymbolText(rcd.svg, false)).toBe(rcd.svg);
  });

  it('counter-flips about the anchor and swaps the alignment', () => {
    const out = uprightSymbolText('<text x="-8" y="4">A</text>', true);
    // Reflection about x = -8 keeps the anchor point fixed...
    expect(out).toContain('transform="translate(-16 0) scale(-1 1)"');
    // ...and `end` makes the text occupy the mirror image of its old box.
    expect(out).toContain('text-anchor="end"');
    expect(uprightSymbolText('<text x="0" text-anchor="middle">A</text>', true)).toContain(
      'text-anchor="middle"',
    );
    expect(uprightSymbolText('<text x="0" text-anchor="end">A</text>', true)).toContain(
      'text-anchor="start"',
    );
  });

  it('honours a text-anchor inherited from a group', () => {
    const out = uprightSymbolText('<g text-anchor="end"><text x="2">A</text></g>', true);
    expect(out).toContain('text-anchor="start"');
  });

  it('keeps an authored text transform, applying the flip in the text frame', () => {
    const out = uprightSymbolText('<text x="3" transform="rotate(90)">A</text>', true);
    expect(out).toContain('transform="rotate(90) translate(6 0) scale(-1 1)"');
  });

  it('maps tspan x positions back through the reflection', () => {
    const out = uprightSymbolText(
      '<text x="5" y="0"><tspan x="5">a</tspan><tspan x="7" dy="8">b</tspan></text>',
      true,
    );
    // F(x') = 2·5 − x' must give back the authored x.
    expect(out).toContain('<tspan x="5">');
    expect(out).toContain('<tspan x="3" dy="8">');
  });

  it('also fixes built-in symbols that carry text (voltmeter "V")', () => {
    const m = compile({
      version: '1',
      elements: [{ id: 'PV1', kind: 'voltmeter' }],
      layout: { PV1: { at: [0, 0], mirror: true } },
    });
    expect(glyphXScale(buildExportSvg(m))).toBe(1);
  });

  it('DXF writes mirrored-symbol text forwards, right-justified at the mirrored anchor', () => {
    const t = elementText(buildExportDxf(compile(file(true))));
    expect(t.get(1)).toBe('I\\U+0394n');
    expect(t.has(71)).toBe(false); // no "backward" flag
    expect(t.get(72)).toBe('2'); // start → right-justified
    // Anchor x = 100 − (−8): mirrored about the placement.
    expect(Number(t.get(10))).toBe(108);
  });
});

describe('custom-symbol text paint (print readability)', () => {
  it('reproduces the bug: text inside a fill="none" stroke group is hollow', () => {
    // As authored, the text inherits fill="none" + stroke — outlines only.
    expect(textTags(rcd.svg)[0]).not.toMatch(/fill=/);
    expect(rcd.svg).toMatch(/<g[^>]*fill="none"/);
  });

  it('gives custom text a solid fill, no stroke and an explicit font', () => {
    const tag = textTags(normalizeSymbolTextPaint(rcd.svg))[0];
    expect(tag).toContain('fill="black"');
    expect(tag).toContain('stroke="none"');
    expect(tag).toContain(`font-size="${SYMBOL_TEXT_DEFAULT_FONT_SIZE}"`);
    expect(tag).toMatch(/font-family="[^"]+"/);
  });

  it('keeps authored fill, size and family, including inherited ones', () => {
    const out = normalizeSymbolTextPaint(
      '<g font-size="7" font-family="Arial"><text x="0" fill="#c00">A</text></g>',
    );
    const tag = textTags(out)[0];
    expect(tag).toContain('fill="#c00"');
    expect(tag).not.toContain('font-size=');
    expect(tag).not.toContain('font-family=');
    expect(tag).toContain('stroke="none"');
  });

  it('applies to every export of a custom kind (the PDF is built from the SVG export)', () => {
    const symbolText = textTags(buildExportSvg(compile(file(false)))).filter((t) =>
      t.includes('stroke="none"'),
    );
    expect(symbolText).toHaveLength(1);
    expect(symbolText[0]).toContain('fill="black"');
  });

  it('DXF picks up the pinned size instead of its own default', () => {
    const t = elementText(buildExportDxf(compile(file(false))));
    expect(Number(t.get(40))).toBe(SYMBOL_TEXT_DEFAULT_FONT_SIZE);
    expect(t.has(72)).toBe(false); // unmirrored, start-aligned
  });

  it('DXF exports a custom symbol drawn inside a plain group', () => {
    const dxf = buildExportDxf(compile(file(false)));
    // The rect inside the <g> wrapper reaches the CAD file.
    expect(dxf.split('\n').filter((l) => l === 'ELEMENTS').length).toBeGreaterThan(1);
  });

  it('never rewrites built-in symbols', () => {
    const m = compile({ version: '1', elements: [{ id: 'PV1', kind: 'voltmeter' }] });
    const lib = m.elements.get('PV1')!.libraryDef!;
    expect(lib.svg).not.toContain('stroke="none"');
  });
});

// ---------------------------------------------------------------------------
// Rotation: a symbol turned 180° (or turned and mirrored so the net turn is
// 180°) used to print its own text upside down.
// ---------------------------------------------------------------------------

type Mat = [number, number, number, number, number, number]; // a b c d e f
const I: Mat = [1, 0, 0, 1, 0, 0];
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
function parseTransform(t: string): Mat {
  let m = I;
  for (const [, op, args] of t.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const a = args.trim().split(/[\s,]+/).map(Number);
    if (op === 'translate') m = mul(m, [1, 0, 0, 1, a[0], a[1] ?? 0]);
    else if (op === 'scale') m = mul(m, [a[0], 0, 0, a[1] ?? a[0], 0, 0]);
    else if (op === 'rotate') {
      const rad = (a[0] * Math.PI) / 180;
      const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
      m = mul(m, [1, 0, 0, 1, cx, cy]);
      m = mul(m, [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0]);
      m = mul(m, [1, 0, 0, 1, -cx, -cy]);
    }
  }
  return m;
}
/** Every transform from the root down to the first `<text>`, composed. */
function textCtm(svg: string): { m: Mat; text: Element } {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const text = doc.querySelector('text')!;
  const chain: Element[] = [];
  for (let el: Element | null = text; el; el = el.parentElement) chain.unshift(el);
  let m = I;
  for (const el of chain) m = mul(m, parseTransform(el.getAttribute('transform') ?? ''));
  return { m, text };
}
const r3 = (n: number) => Math.round(n * 1000) / 1000 + 0;
const linear = (m: Mat) => [m[0], m[1], m[2], m[3]].map(r3);
const apply = (m: Mat, p: [number, number]): [number, number] => [
  r3(m[0] * p[0] + m[2] * p[1] + m[4]),
  r3(m[1] * p[0] + m[3] * p[1] + m[5]),
];
const inSvg = (frag: string, rot: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg"><g transform="rotate(${rot})">${frag}</g></svg>`;

const placed = (rot: 0 | 90 | 180 | 270, mirror = false): DiagramFile => ({
  version: '1',
  customKinds: [rcd],
  elements: [{ id: 'RCD1', kind: 'custom:rcd-light' }],
  layout: { RCD1: { at: [100, 100], rot, ...(mirror ? { mirror: true } : {}) } },
});

describe('rotated symbol text', () => {
  it('reproduces the bug: at 180° the glyphs are upside down', () => {
    expect(linear(textCtm(inSvg(rcd.svg, 180)).m)).toEqual([-1, 0, 0, -1]);
  });

  it('SVG export at 180° draws the glyphs upright', () => {
    const { m } = textCtm(buildExportSvg(compile(placed(180))));
    expect(linear(m)).toEqual([1, 0, 0, 1]);
  });

  it('…in the box the turned symbol gives its text', () => {
    // Authored "IΔn" at (-8, 4), start-anchored, 16px: its box runs right
    // from x −8 with the caps above y 4. Turned 180° about (100, 100) that
    // box runs LEFT from x 108 and hangs DOWN from y 96: so the upright text
    // is end-anchored at x 108, baseline one cap height below 96.
    const { m, text } = textCtm(buildExportSvg(compile(placed(180))));
    expect(text.getAttribute('text-anchor')).toBe('end');
    const [x, y] = apply(m, [-8, 4]);
    expect(x).toBe(108);
    expect(y).toBeCloseTo(96 + 0.716 * SYMBOL_TEXT_DEFAULT_FONT_SIZE, 0);
  });

  it('rotate + mirror (net 180°) is upright too, keeping its alignment', () => {
    // Mirror then 180° is a vertical flip: the box stays start-anchored.
    const { m, text } = textCtm(buildExportSvg(compile(placed(180, true))));
    expect(linear(m)).toEqual([1, 0, 0, 1]);
    expect(text.getAttribute('text-anchor') ?? 'start').toBe('start');
    expect(apply(m, [-8, 4])[0]).toBe(92);
    // Written as one vertical flip: svg2pdf.js (PDF export) misplaces text
    // under the equivalent composed `scale(-1 1) rotate(180 …)`.
    expect(text.getAttribute('transform')).toMatch(/^translate\(0 [-\d.]+\) scale\(1 -1\)$/);
  });

  it('90° and 270° stay turned (read from the side), never mirrored', () => {
    for (const mirror of [false, true]) {
      expect(linear(textCtm(buildExportSvg(compile(placed(90, mirror)))).m)).toEqual([0, 1, -1, 0]);
      expect(linear(textCtm(buildExportSvg(compile(placed(270, mirror)))).m)).toEqual([0, -1, 1, 0]);
    }
  });

  it('is the identity when nothing needs turning', () => {
    expect(uprightSymbolText(rcd.svg, false, 0)).toBe(rcd.svg);
    expect(uprightSymbolText(rcd.svg, false, 90)).toBe(rcd.svg);
    expect(uprightSymbolText(rcd.svg, false)).toBe(rcd.svg);
  });

  it('keeps the line order of a multi-line text', () => {
    const svg =
      '<text x="0" y="0" font-size="10"><tspan x="0" y="0">A</tspan><tspan x="0" y="12">B</tspan></text>';
    const { m } = textCtm(inSvg(uprightSymbolText(svg, false, 180), 180));
    expect(linear(m)).toEqual([1, 0, 0, 1]);
    // A rigid move: line B still sits 12 below line A.
    expect(apply(m, [0, 12])[1] - apply(m, [0, 0])[1]).toBe(12);
  });

  it('a centred (dominant-baseline middle) label turns about its own centre', () => {
    const svg =
      '<text x="5" y="3" text-anchor="middle" dominant-baseline="middle" font-size="10">V</text>';
    const { m } = textCtm(inSvg(uprightSymbolText(svg, false, 180), 180));
    expect(linear(m)).toEqual([1, 0, 0, 1]);
    expect(apply(m, [5, 3])).toEqual([-5, -3]);
  });

  it('DXF writes 180° symbol text upright, hanging from the turned baseline', () => {
    const t = elementText(buildExportDxf(compile(placed(180))));
    expect(t.has(50)).toBe(false); // no rotation
    expect(t.get(72)).toBe('2'); // start → right-justified
    expect(t.get(73)).toBe('3'); // top-aligned: the text hangs below the anchor
    expect(Number(t.get(11))).toBe(108);
    // World y 96 → DXF y −96 (DXF y points up).
    expect(Number(t.get(21))).toBe(-96);
  });

  it('DXF rotate + mirror (net 180°) is upright and keeps its justification', () => {
    const t = elementText(buildExportDxf(compile(placed(180, true))));
    expect(t.has(50)).toBe(false);
    expect(t.has(72)).toBe(false);
    expect(t.get(73)).toBe('3');
    expect(Number(t.get(11))).toBe(92);
  });
});
