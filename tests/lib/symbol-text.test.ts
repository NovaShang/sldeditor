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
