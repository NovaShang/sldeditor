/**
 * The palette is a contract between four renderers (canvas, SVG export, PNG
 * via that SVG, DXF) that have no other way to agree with each other. These
 * tests pin the two properties that matter:
 *
 *   1. an absent / `default` colour is invisible in the output, so a diagram
 *      written before colours existed renders and exports byte-identically;
 *   2. every name resolves in all three media, so a colour can never be
 *      offered in the picker but silently dropped on the way to a file.
 */

import { describe, expect, it } from 'vitest';
import {
  COLOR_ORDER,
  NAMED_COLORS,
  dxfColor,
  exportInk,
  inkClass,
} from '../../src/lib/colors';
import type { DiagramColor } from '../../src/model';

describe('default is indistinguishable from absent', () => {
  it('adds no CSS class', () => {
    expect(inkClass(undefined)).toBeUndefined();
    expect(inkClass('default')).toBeUndefined();
  });

  it('exports the literal `black` the exporters emitted before colours', () => {
    expect(exportInk(undefined)).toBe('black');
    expect(exportInk('default')).toBe('black');
  });

  it('omits the DXF colour override so the entity inherits its layer', () => {
    expect(dxfColor(undefined)).toBeUndefined();
    expect(dxfColor('default')).toBeUndefined();
  });
});

describe('every named colour resolves in every medium', () => {
  const named = COLOR_ORDER.filter((c) => c !== 'default');

  it.each(named)('%s has a class, an export ink and an ACI index', (c) => {
    expect(inkClass(c)).toBe(`ole-ink-${c}`);
    expect(exportInk(c)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(dxfColor(c)).toBeTypeOf('number');
  });

  it('covers the whole DiagramColor union in the picker order', () => {
    expect([...COLOR_ORDER].sort()).toEqual(
      (Object.keys(NAMED_COLORS) as DiagramColor[]).sort(),
    );
  });

  it('gives each colour a distinct ACI index', () => {
    const acis = COLOR_ORDER.map((c) => NAMED_COLORS[c].aci);
    expect(new Set(acis).size).toBe(acis.length);
  });

  it('has a distinct light and dark value for each name', () => {
    // If a name resolved to the same ink in both themes it would either be
    // invisible on one of them or pointless — this is the check that keeps
    // the dark-theme promise honest.
    for (const c of named) {
      expect(NAMED_COLORS[c].light).not.toBe(NAMED_COLORS[c].dark);
    }
  });
});

describe('unknown values degrade instead of throwing', () => {
  it('treats a colour from a newer file as default', () => {
    // Forward compatibility: an older bundle opening a file that used a
    // colour added later must fall back to theme ink, not crash the canvas.
    const future = 'chartreuse' as DiagramColor;
    expect(inkClass(future)).toBeUndefined();
    expect(exportInk(future)).toBe('black');
    expect(dxfColor(future)).toBeUndefined();
  });
});
