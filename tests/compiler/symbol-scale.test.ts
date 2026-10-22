/**
 * `Placement.scale` — a per-symbol size factor.
 *
 * The contract: absent means 1 and every diagram written before the field
 * existed compiles byte-identically; a scaled symbol's TERMINALS move with it
 * (or wires would stop landing on the pins); the drawing's line weight does
 * not; and out-of-range values are clamped rather than trusted.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() {
      return mem.size;
    },
    key: (i: number) => [...mem.keys()][i] ?? null,
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
    removeItem: (k: string) => {
      mem.delete(k);
    },
    clear: () => {
      mem.clear();
    },
  } as Storage;
});

import { compile, resolvePlacement, transformPoint } from '../../src/compiler';
import { transformAttr } from '../../src/canvas/transform-attr';
import { compensateStrokes } from '../../src/lib/symbol-scale';
import { buildExportSvg } from '../../src/lib/export-image';
import { useEditorStore } from '../../src/store';
import type { DiagramFile } from '../../src/model';

const at0 = (scale?: number, extra: object = {}): DiagramFile => ({
  version: '1',
  elements: [{ id: 'QF1', kind: 'breaker' }],
  layout: { QF1: { at: [100, 100], ...(scale !== undefined ? { scale } : {}), ...extra } },
});

const pin = (d: DiagramFile, ref: string) => compile(d).terminals.get(ref)!.world;

describe('placement scale — geometry', () => {
  it('defaults to 1: absent and 1 resolve identically, and 1 is not stored', () => {
    expect(resolvePlacement({ at: [0, 0] })).toEqual(resolvePlacement({ at: [0, 0], scale: 1 }));
    expect('scale' in resolvePlacement({ at: [0, 0], scale: 1 })).toBe(false);
  });

  it('moves terminals with the symbol (breaker pins at ±20 local)', () => {
    expect(pin(at0(), 'QF1.t1')).toEqual([100, 80]);
    expect(pin(at0(2), 'QF1.t1')).toEqual([100, 60]);
    expect(pin(at0(2), 'QF1.t2')).toEqual([100, 140]);
    expect(pin(at0(0.5), 'QF1.t2')).toEqual([100, 110]);
  });

  it('composes with rotation and mirror (scale first)', () => {
    const p = resolvePlacement({ at: [0, 0], rot: 90, mirror: true, scale: 2 });
    // local (3, 5) → scale (6, 10) → mirror (-6, 10) → rot90 (-10, -6)
    expect(transformPoint([3, 5], p)).toEqual([-10, -6]);
    expect(transformAttr(p)).toBe('translate(0 0) rotate(90) scale(-2 2)');
  });

  it('clamps out-of-range and junk values', () => {
    expect(resolvePlacement({ at: [0, 0], scale: 100 }).scale).toBe(4);
    expect(resolvePlacement({ at: [0, 0], scale: 0.01 }).scale).toBe(0.25);
    expect(resolvePlacement({ at: [0, 0], scale: -2 }).scale).toBeUndefined();
    expect(resolvePlacement({ at: [0, 0], scale: Number.NaN }).scale).toBeUndefined();
  });

  it('leaves an unscaled transform exactly as before', () => {
    expect(transformAttr(resolvePlacement({ at: [5, 6] }))).toBe('translate(5 6)');
    expect(transformAttr(resolvePlacement({ at: [5, 6], mirror: true }))).toBe(
      'translate(5 6) scale(-1 1)',
    );
  });
});

describe('placement scale — line weight stays the drawing’s', () => {
  it('divides stroke widths by the scale', () => {
    const svg = '<line stroke-width="1"/><circle stroke-width="0.4"/>';
    expect(compensateStrokes(svg, 2)).toBe('<line stroke-width="0.5"/><circle stroke-width="0.2"/>');
    expect(compensateStrokes(svg, 1)).toBe(svg);
    expect(compensateStrokes(svg, undefined)).toBe(svg);
  });

  it('export draws the scaled symbol with compensated strokes', () => {
    const d = at0(2);
    const out = buildExportSvg(compile(d), { annotations: d.annotations });
    expect(out).toContain('scale(2 2)');
    expect(out).toContain('stroke-width="0.5"');
    expect(out).not.toMatch(/scale\(2 2\)[^<]*>\s*<[^>]*stroke-width="1"/);
  });
});

describe('placement scale — store', () => {
  const store = () => useEditorStore.getState();
  beforeEach(() => store().setDiagram(structuredClone(at0())));

  it('updatePlacement sets scale as one undo step and keeps rot/mirror', () => {
    store().setDiagram(structuredClone(at0(undefined, { rot: 90, mirror: true })));
    const before = store().past.length;
    store().updatePlacement('QF1', { scale: 1.5 });
    expect(store().diagram.layout?.QF1).toEqual({ at: [100, 100], rot: 90, mirror: true, scale: 1.5 });
    expect(store().past.length).toBe(before + 1);
  });

  it('setting 1 DELETES the field so the file is unchanged', () => {
    store().updatePlacement('QF1', { scale: 2 });
    store().updatePlacement('QF1', { scale: 1 });
    expect('scale' in (store().diagram.layout!.QF1 as object)).toBe(false);
  });

  it('a later move keeps the size', () => {
    store().updatePlacement('QF1', { scale: 2 });
    store().updatePlacement('QF1', { at: [300, 300] });
    expect(store().diagram.layout?.QF1.scale).toBe(2);
  });
});

describe('placement scale — drag gesture (corner grips)', () => {
  const store = () => useEditorStore.getState();
  beforeEach(() => store().setDiagram(structuredClone(at0())));

  it('a whole drag is ONE undo entry, with terminals following live', () => {
    const before = store().past.length;
    store().previewPlacement('QF1', { scale: 1.2 });
    store().previewPlacement('QF1', { scale: 1.7 });
    expect(store().internal.terminals.get('QF1.t1')!.world).toEqual([100, 66]);
    expect(store().past.length).toBe(before); // nothing committed mid-drag
    store().endGesture(true);
    expect(store().past.length).toBe(before + 1);
    expect(store().diagram.layout?.QF1.scale).toBe(1.7);
    store().undo();
    expect(store().diagram.layout?.QF1.scale).toBeUndefined();
  });

  it('a cancelled drag restores the size it had and records nothing', () => {
    store().updatePlacement('QF1', { scale: 2 });
    const before = store().past.length;
    store().previewPlacement('QF1', { scale: 3 });
    store().endGesture(false);
    expect(store().diagram.layout?.QF1.scale).toBe(2);
    expect(store().past.length).toBe(before);
    expect(store().gestureBase).toBeNull();
  });

  it('a drag that ends where it started records nothing', () => {
    const before = store().past.length;
    store().endGesture(true);
    expect(store().past.length).toBe(before);
  });
});
