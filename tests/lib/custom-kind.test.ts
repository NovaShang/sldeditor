/**
 * The two gates on a document-defined symbol.
 *
 * @vitest-environment jsdom
 *
 * (jsdom for `DOMParser` — the sanitizer parses markup rather than pattern-
 * matching it, because markup an adversary controls is not a regular language.)
 */

import { describe, expect, it } from 'vitest';
import { sanitizeSymbolSvg, validateCustomKind } from '../../src/lib/custom-kind';
import { mergeCustomKinds, LIBRARY } from '../../src/compiler/library-index';
import { compile } from '../../src/compiler';
import type { DiagramFile, LibraryEntry } from '../../src/model';

/** A minimal well-formed symbol: a box with a pin top and bottom. */
const goodKind = (over: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id: 'custom:panel-2way',
  name: '2-way panel',
  category: 'distribution',
  viewBox: '-20 -30 40 60',
  width: 40,
  height: 60,
  svg: '<rect x="-20" y="-30" width="40" height="60" fill="none" stroke="black" stroke-width="1"/>',
  terminals: [
    { id: 't1', x: 0, y: -28, orientation: 'n' },
    { id: 't2', x: 0, y: 28, orientation: 's' },
  ],
  ...over,
});

describe('sanitizer — allowlist, not blocklist', () => {
  const cases: [string, string, string][] = [
    ['script tag', '<line x1="0" y1="0" x2="1" y2="1"/><script>alert(1)</script>', 'element:script'],
    ['event handler', '<rect width="10" height="10" onload="alert(1)"/>', 'attr:onload'],
    ['inline click handler', '<circle r="5" onclick="fetch(`/x`)"/>', 'attr:onclick'],
    ['foreignObject', '<foreignObject><div>x</div></foreignObject>', 'element:foreignobject'],
    ['external image', '<image href="https://evil.example/x.png" width="10" height="10"/>', 'element:image'],
    ['use with href', '<use href="#x"/>', 'element:use'],
    ['style element', '<style>*{fill:red}</style>', 'element:style'],
    ['anchor', '<a href="javascript:alert(1)"><rect width="1" height="1"/></a>', 'element:a'],
    ['style attribute', '<rect width="1" height="1" style="background:url(javascript:1)"/>', 'attr:style'],
    ['animation', '<animate attributeName="x" to="9"/>', 'element:animate'],
  ];

  for (const [label, payload, expected] of cases) {
    it(`strips ${label}`, () => {
      const { svg, removed } = sanitizeSymbolSvg(payload);
      expect(removed).toContain(expected);
      expect(svg).not.toMatch(/script|onload|onclick|javascript:|foreignObject|<a[\s>]/i);
    });
  }

  it('strips a namespaced href, which is the same attribute wearing a prefix', () => {
    const { removed } = sanitizeSymbolSvg(
      '<use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="#x"/>',
    );
    expect(removed).toContain('element:use');
  });

  it('keeps everything the shipped library actually uses', () => {
    const real =
      '<g transform="translate(1 2)">' +
      '<line x1="0" y1="-20" x2="0" y2="20" stroke="black" stroke-width="1"/>' +
      '<rect x="-7" y="-9" width="14" height="18" fill="none" stroke="black" stroke-width="1"/>' +
      '<circle cx="0" cy="0" r="3" fill="#000000"/>' +
      '<ellipse cx="0" cy="0" rx="4" ry="2" fill="none" stroke="black"/>' +
      '<polyline points="0,0 4,4" fill="none" stroke="black"/>' +
      '<polygon points="0,0 4,0 2,4" fill="black"/>' +
      '<path d="M0 0 L4 4" fill="none" stroke="black" stroke-dasharray="2 2"/>' +
      '<text x="0" y="0" font-family="sans-serif" font-size="6" text-anchor="middle">1</text>' +
      '</g>';
    const { svg, removed } = sanitizeSymbolSvg(real);
    expect(removed).toEqual([]);
    for (const tag of ['line', 'rect', 'circle', 'ellipse', 'polyline', 'polygon', 'path', 'text']) {
      expect(svg).toContain(`<${tag}`);
    }
  });

  it('returns nothing rather than something dangerous when the markup will not parse', () => {
    expect(sanitizeSymbolSvg('<rect').svg).toBe('');
  });
});

describe('structural validation', () => {
  it('accepts a well-formed symbol', () => {
    expect(validateCustomKind(goodKind())).toEqual([]);
  });

  it('requires the custom: namespace so a document cannot redefine `breaker`', () => {
    const problems = validateCustomKind(goodKind({ id: 'breaker' }));
    expect(problems.map((p) => p.field)).toContain('id');
  });

  it('rejects a pin floating outside the symbol body', () => {
    const problems = validateCustomKind(
      goodKind({ terminals: [{ id: 't1', x: 0, y: -28, orientation: 'n' }, { id: 't2', x: 0, y: 400, orientation: 's' }] }),
    );
    expect(problems.some((p) => /outside the viewBox/.test(p.message))).toBe(true);
  });

  it('rejects a two-pin device whose pins share neither axis', () => {
    // This is the one that would poison every future drawing: such a symbol
    // renders a jogged wire no matter how carefully anything is placed.
    const problems = validateCustomKind(
      goodKind({ terminals: [{ id: 't1', x: -10, y: -28, orientation: 'n' }, { id: 't2', x: 10, y: 28, orientation: 's' }] }),
    );
    expect(problems.some((p) => /right-angle jog/.test(p.message))).toBe(true);
  });

  it('allows an off-axis pin pair as long as they share one coordinate', () => {
    // `ct` in the shipped library is exactly this: both pins at x = -30.
    expect(
      validateCustomKind(
        goodKind({ terminals: [{ id: 't1', x: -15, y: -28, orientation: 'n' }, { id: 't2', x: -15, y: 28, orientation: 's' }] }),
      ),
    ).toEqual([]);
  });

  it('does not impose an axis rule on multi-pin symbols', () => {
    // A combiner legitimately spreads its inputs; only the 2-pin series case
    // has a single unambiguous run axis.
    expect(
      validateCustomKind(
        goodKind({
          terminals: [
            { id: 's1', x: -10, y: -28, orientation: 'n' },
            { id: 's2', x: 0, y: -28, orientation: 'n' },
            { id: 's3', x: 10, y: -28, orientation: 'n' },
            { id: 'out', x: 0, y: 28, orientation: 's' },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('catches duplicate terminal ids', () => {
    const problems = validateCustomKind(
      goodKind({ terminals: [{ id: 't1', x: 0, y: -28, orientation: 'n' }, { id: 't1', x: 0, y: 28, orientation: 's' }] }),
    );
    expect(problems.some((p) => /duplicate terminal/.test(p.message))).toBe(true);
  });

  it('rejects a symbol nothing can be wired to', () => {
    const problems = validateCustomKind(goodKind({ terminals: [] }));
    expect(problems.some((p) => /at least one terminal/.test(p.message))).toBe(true);
  });
});

describe('the merged lookup', () => {
  it('returns the built-in map untouched when a document defines nothing', () => {
    expect(mergeCustomKinds(undefined)).toBe(LIBRARY);
    expect(mergeCustomKinds([])).toBe(LIBRARY);
  });

  it('resolves custom and built-in kinds side by side', () => {
    const merged = mergeCustomKinds([goodKind()]);
    expect(merged.get('custom:panel-2way')?.name).toBe('2-way panel');
    expect(merged.get('breaker')).toBeDefined();
    expect(LIBRARY.has('custom:panel-2way')).toBe(false); // built-ins untouched
  });

  it('refuses to let an un-namespaced entry shadow a built-in', () => {
    const merged = mergeCustomKinds([goodKind({ id: 'breaker', name: 'HIJACKED' })]);
    expect(merged.get('breaker')?.name).not.toBe('HIJACKED');
  });

  it('compiles a document that uses its own kind, wires and all', () => {
    const file: DiagramFile = {
      version: '1',
      customKinds: [goodKind()],
      elements: [
        { id: 'P1', kind: 'custom:panel-2way' },
        { id: 'QF1', kind: 'breaker' },
      ],
      wires: [{ id: 'w1', ends: ['QF1.t2', 'P1.t1'] }],
      layout: { P1: { at: [0, 200] }, QF1: { at: [0, 0] } },
    };
    const m = compile(file);
    expect(m.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(m.elements.get('P1')?.libraryDef?.name).toBe('2-way panel');
    // The real proof: the custom pin joined a connectivity node with the
    // built-in's pin, so it is electrically part of the diagram.
    expect(m.terminalToNode.get('P1.t1')).toBeDefined();
    expect(m.terminalToNode.get('P1.t1')).toBe(m.terminalToNode.get('QF1.t2'));
  });

  it('reports an unknown kind rather than crashing when a definition is missing', () => {
    // What an older bundle sees when it opens a newer file.
    const m = compile({
      version: '1',
      elements: [{ id: 'P1', kind: 'custom:panel-2way' }],
    });
    expect(m.diagnostics.some((d) => d.code === 'E003')).toBe(true);
  });
});
