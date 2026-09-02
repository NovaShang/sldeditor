/**
 * IEC ⇄ ANSI symbol standard.
 *
 * Requested as "give selection of symbol variation. in example for Circuit
 * breaker, we can select either to use IEC symbol or ANSI". The contract that
 * matters is NOT "does it swap a picture" — it is that swapping the picture is
 * *all* it does. A standard switch that nudged a pin would silently re-route a
 * finished drawing, which is the one failure mode that would make the feature
 * unusable on real work.
 *
 * @vitest-environment jsdom
 *
 * (The DXF writer parses symbol artwork with `DOMParser`.)
 */

import { describe, expect, it } from 'vitest';
import { LIBRARY, applySymbolStandard, compile } from '../../src/compiler';
import { buildExportDxf } from '../../src/lib/export-dxf';
import { buildExportSvg } from '../../src/lib/export-image';
import type { DiagramFile, SymbolStandard } from '../../src/model';

const ANSI = applySymbolStandard(LIBRARY, 'ansi');

/** Every entry that ships an alternate drawing. */
const withVariants = [...LIBRARY.values()].filter((e) => e.variants);

const diagram = (standard?: SymbolStandard): DiagramFile => ({
  version: '1',
  elements: [
    { id: 'QF1', kind: 'breaker' },
    { id: 'FU1', kind: 'fuse' },
  ],
  layout: { QF1: { at: [0, 0] }, FU1: { at: [100, 0] } },
  wires: [{ id: 'w1', ends: ['QF1.t2', 'FU1.t1'] }],
  ...(standard ? { meta: { symbolStandard: standard } } : {}),
});

describe('applySymbolStandard', () => {
  it('is the identity for IEC and for an unset standard', () => {
    // Same object, not merely equal: this runs on every keystroke and must not
    // rebuild a ninety-entry map for the overwhelmingly common case.
    expect(applySymbolStandard(LIBRARY, 'iec')).toBe(LIBRARY);
    expect(applySymbolStandard(LIBRARY, undefined)).toBe(LIBRARY);
  });

  it('swaps the drawing of every entry that has one', () => {
    expect(withVariants.length).toBeGreaterThan(0);
    for (const base of withVariants) {
      const v = base.variants!.ansi!;
      const applied = ANSI.get(base.id)!;
      expect(applied.svg).toBe(v.svg);
      expect(applied.viewBox).toBe(v.viewBox);
      expect(applied.width).toBe(v.width);
      expect(applied.height).toBe(v.height);
      expect(applied.svg).not.toBe(base.svg);
    }
  });

  it('leaves entries without an alternate drawing untouched', () => {
    for (const [id, entry] of LIBRARY) {
      if (entry.variants) continue;
      expect(ANSI.get(id)).toBe(entry);
    }
  });

  it('never moves a pin, and never touches the electrical schema', () => {
    for (const base of withVariants) {
      const applied = ANSI.get(base.id)!;
      expect(applied.terminals).toEqual(base.terminals);
      expect(applied.params).toEqual(base.params);
      expect(applied.state).toEqual(base.state);
      expect(applied.category).toBe(base.category);
      expect(applied.stretchable).toEqual(base.stretchable);
    }
  });

  it('keeps every pin inside the alternate frame', () => {
    // A frame that did not reach the terminals would leave wires ending in
    // empty space the moment the standard was switched.
    for (const base of withVariants) {
      const v = base.variants!.ansi!;
      const [x, y, w, h] = v.viewBox.split(/\s+/).map(Number);
      for (const t of base.terminals) {
        expect(t.x).toBeGreaterThanOrEqual(x);
        expect(t.x).toBeLessThanOrEqual(x + w);
        expect(t.y).toBeGreaterThanOrEqual(y);
        expect(t.y).toBeLessThanOrEqual(y + h);
      }
    }
  });

  it('records which clause of which standard each drawing came from', () => {
    for (const base of withVariants) {
      const src = base.variants!.ansi!.source;
      expect(src.standard).toMatch(/IEEE Std 315-1975/);
      expect(src.clause).toMatch(/^\d+(\.\d+)+$/);
    }
  });
});

describe('the two drawings that actually differ', () => {
  it('draws the ANSI breaker as the square of IEEE 315 §9.4.4', () => {
    const v = LIBRARY.get('breaker')!.variants!.ansi!;
    expect(v.source.clause).toBe('9.4.4');
    // A true square, centred on the conductor, with the lead entering middle.
    expect(v.svg).toContain('<rect x="-9" y="-9" width="18" height="18"');
    // The IEC drawing is the crossed blade; nothing of it survives.
    expect(v.svg).not.toContain('polyline');
  });

  it('draws the ANSI fuse as the S of IEEE 315 §9.1.1', () => {
    const v = LIBRARY.get('fuse')!.variants!.ansi!;
    expect(v.source.clause).toBe('9.1.1');
    // Two arcs of opposite sweep — an S, not a C.
    expect(v.svg).toContain('A 6 7 0 0 1 0 0');
    expect(v.svg).toContain('A 6 7 0 0 0 0 14');
    // The IEC drawing is the rectangle; nothing of it survives.
    expect(v.svg).not.toContain('<rect');
  });

  it('pushes the label clear of the wider ANSI body', () => {
    const base = LIBRARY.get('breaker')!;
    const v = base.variants!.ansi!;
    // The IEC anchor sits at x=6, which is inside the ANSI square.
    expect(base.label!.x).toBeLessThan(9);
    expect(v.label!.x).toBeGreaterThan(9);
  });
});

describe('compile + export under a standard', () => {
  it('resolves the drawing once, so every renderer agrees', () => {
    const m = compile(diagram('ansi'));
    expect(m.elements.get('QF1')!.libraryDef!.svg).toBe(
      LIBRARY.get('breaker')!.variants!.ansi!.svg,
    );
    // The compiled library map is what the canvas palette and place-ghost read.
    expect(m.library.get('breaker')!.svg).toContain('<rect');
  });

  it('leaves terminal world positions and connectivity identical', () => {
    const iec = compile(diagram());
    const ansi = compile(diagram('ansi'));
    for (const ref of ['QF1.t1', 'QF1.t2', 'FU1.t1', 'FU1.t2'] as const) {
      expect(ansi.terminals.get(ref)!.world).toEqual(
        iec.terminals.get(ref)!.world,
      );
    }
    expect(ansi.nodes.size).toBe(iec.nodes.size);
    expect(ansi.diagnostics).toEqual(iec.diagnostics);
  });

  it('carries the choice into the SVG export', () => {
    const ansi = buildExportSvg(compile(diagram('ansi')));
    expect(ansi).toContain('width="18" height="18"');
    const iec = buildExportSvg(compile(diagram('iec')));
    expect(iec).not.toContain('width="18" height="18"');
  });

  it('reaches the DXF too — the S is an arc path, not a line', () => {
    // The ANSI fuse is the library's first symbol drawn with an `A` command.
    // The DXF writer samples arcs into a polyline; if it ever stopped
    // handling `A`, the fuse would silently vanish from CAD exports while
    // still looking right on screen.
    // The writer emits R12 POLYLINE + VERTEX records (never LWPOLYLINE), and
    // samples the arc into vertices — so the S shows up as a long vertex run
    // that the straight-edged IEC drawing has no counterpart for.
    const vertices = (d: string) => d.split('\nVERTEX\n').length - 1;
    expect(vertices(buildExportDxf(compile(diagram('ansi'))))).toBeGreaterThan(
      vertices(buildExportDxf(compile(diagram('iec')))) + 20,
    );
  });

  it('exports a diagram with no standard set exactly as `iec`', () => {
    // Absent === IEC, so every drawing made before the setting existed keeps
    // rendering byte-for-byte the way it did.
    expect(buildExportSvg(compile(diagram()))).toBe(
      buildExportSvg(compile(diagram('iec'))),
    );
  });
});
