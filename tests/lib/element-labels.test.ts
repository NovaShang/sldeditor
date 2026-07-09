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
  LABEL_LINE_HEIGHT,
  placeLabel,
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
