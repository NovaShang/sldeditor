/**
 * Wire labels (`Wire.label`, e.g. phase designations L1/L2/L3/N/PE) anchor at
 * the midpoint of the wire's longest rendered segment, offset perpendicular
 * so they never sit on the line, and stay upright regardless of segment
 * direction. These tests pin the placement math plus the three surfaces that
 * must agree: serialization round-trip, SVG export, and DXF export.
 */

import { describe, expect, it } from 'vitest';
import { compile } from '../../src/compiler';
import { LABEL_FONT_SIZE } from '../../src/lib/element-labels';
import {
  WIRE_LABEL_OFFSET,
  placeWireLabel,
} from '../../src/lib/wire-labels';
import { buildExportDxf } from '../../src/lib/export-dxf';
import { buildExportSvg } from '../../src/lib/export-image';
import type { DiagramFile } from '../../src/model';

// Minimal in-memory localStorage so the store's persist middleware loads
// under node (the editor persists UI prefs; tests don't care about them).
const mem = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
} as Storage;
const { useEditorStore } = await import('../../src/store');

/** Two junctions joined by one straight wire — deterministic render path. */
const wireBetween = (
  a: [number, number],
  b: [number, number],
  label?: string,
): DiagramFile => ({
  version: '1',
  elements: [],
  junctions: [
    { id: 'J1', layout: { at: a } },
    { id: 'J2', layout: { at: b } },
  ],
  wires: [{ id: 'w1', ends: ['J1', 'J2'], ...(label ? { label } : {}) }],
});

describe('placeWireLabel', () => {
  it('centers above the midpoint of a horizontal segment', () => {
    const p = placeWireLabel([
      [0, 100],
      [200, 100],
    ]);
    expect(p).not.toBeNull();
    expect(p!.world).toEqual([100, 100 - WIRE_LABEL_OFFSET]);
    expect(p!.textAnchor).toBe('middle');
  });

  it('flows right from the midpoint of a vertical segment', () => {
    const p = placeWireLabel([
      [50, 0],
      [50, 200],
    ]);
    expect(p).not.toBeNull();
    expect(p!.world).toEqual([
      50 + WIRE_LABEL_OFFSET,
      100 + LABEL_FONT_SIZE / 3,
    ]);
    expect(p!.textAnchor).toBe('start');
  });

  it('anchors on the longest segment of an L-shaped path', () => {
    // Short horizontal stub, long vertical run → label follows the run.
    const p = placeWireLabel([
      [0, 0],
      [10, 0],
      [10, 100],
    ]);
    expect(p).not.toBeNull();
    expect(p!.world).toEqual([
      10 + WIRE_LABEL_OFFSET,
      50 + LABEL_FONT_SIZE / 3,
    ]);
    expect(p!.textAnchor).toBe('start');
  });

  it('returns null for degenerate paths', () => {
    expect(placeWireLabel([])).toBeNull();
    expect(placeWireLabel([[5, 5]])).toBeNull();
    expect(
      placeWireLabel([
        [5, 5],
        [5, 5],
      ]),
    ).toBeNull();
  });
});

describe('serialization round-trip', () => {
  it('survives JSON save/load untouched', () => {
    const d = wireBetween([0, 100], [200, 100], 'L1');
    // Mirrors file-io: serialize is JSON.stringify, parse is JSON.parse.
    const back = JSON.parse(JSON.stringify(d, null, 2)) as DiagramFile;
    expect(back.wires?.[0].label).toBe('L1');
    expect(back).toEqual(d);
  });

  it('is carried onto the compiled WireRender', () => {
    const m = compile(wireBetween([0, 100], [200, 100], 'PE'));
    expect(m.wireRenders.get('w1')?.label).toBe('PE');
  });

  it('survives store edits that rebuild the wire (updateWirePath)', () => {
    const store = useEditorStore.getState();
    store.setDiagram(wireBetween([0, 100], [200, 100], 'L2'));
    useEditorStore.getState().updateWirePath('w1', [
      [0, 100],
      [100, 100],
      [100, 140],
      [200, 140],
    ]);
    const w = useEditorStore.getState().diagram.wires?.[0];
    expect(w?.path).toBeDefined();
    expect(w?.label).toBe('L2');
    // updateWire clears it again (panel commits '' as undefined).
    useEditorStore.getState().updateWire('w1', { label: undefined });
    expect(useEditorStore.getState().diagram.wires?.[0].label).toBeUndefined();
  });
});

describe('export SVG', () => {
  it('emits a horizontal wire label centered above the wire', () => {
    const svg = buildExportSvg(compile(wireBetween([0, 100], [200, 100], 'L1')));
    const m = svg.match(
      /<text x="([-\d.]+)" y="([-\d.]+)" text-anchor="middle">L1<\/text>/,
    );
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(100);
    expect(Number(m![2])).toBe(100 - WIRE_LABEL_OFFSET);
  });

  it('emits a vertical wire label start-anchored right of the wire', () => {
    const svg = buildExportSvg(compile(wireBetween([50, 0], [50, 200], 'N')));
    const m = svg.match(
      /<text x="([-\d.]+)" y="([-\d.]+)" text-anchor="start">N<\/text>/,
    );
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(50 + WIRE_LABEL_OFFSET);
    expect(Number(m![2])).toBeCloseTo(100 + LABEL_FONT_SIZE / 3, 6);
  });

  it('renders nothing for an absent label and hides at labelMode off', () => {
    const plain = buildExportSvg(compile(wireBetween([0, 100], [200, 100])));
    expect(plain).not.toContain('text-anchor');
    const off = buildExportSvg(compile(wireBetween([0, 100], [200, 100], 'L3')), {
      labelMode: 'off',
    });
    expect(off).not.toContain('L3');
  });
});

describe('export DXF', () => {
  it('emits the wire label as TEXT on the LABELS layer', () => {
    const dxf = buildExportDxf(compile(wireBetween([0, 100], [200, 100], 'L1')));
    // TEXT entity on LABELS carrying the label string (group code 1).
    expect(dxf).toMatch(/0\nTEXT\n8\nLABELS\n[\s\S]*?\n1\nL1\n/);
    // Horizontal placement centers the text (group 72 = 1 follows the value).
    expect(dxf).toMatch(/\n1\nL1\n72\n1\n/);
  });

  it('emits nothing extra when the wire has no label', () => {
    const dxf = buildExportDxf(compile(wireBetween([0, 100], [200, 100])));
    expect(dxf).not.toContain('TEXT');
  });
});
