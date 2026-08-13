/**
 * The DXF export has to survive a *parser*, not an eyeball — it is the file a
 * consultant drops into AutoCAD next to the rest of a drawing set.
 *
 * It did not. The writer declared `$ACADVER = AC1009` (R12) and then emitted
 * `LWPOLYLINE`, an entity that did not exist until R14, without the
 * `AcDbEntity`/`AcDbPolyline` subclass markers R13+ readers require. A reader
 * honouring the header skipped every wire and bus (all of them are polylines);
 * a reader going by entity type rejected the whole file. It reached users as
 * "dxf downloaded is blank" and every export produced since the feature shipped
 * was unopenable.
 *
 * These tests assert the shape of the emitted group-code stream, because that
 * is the level the bug lived at — the old output looked perfectly reasonable
 * unless you knew which DXF version each entity belongs to.
 *
 * @vitest-environment jsdom
 *
 * (The writer parses each symbol's SVG with `DOMParser` to emit its geometry,
 * so a DOM is required to exercise anything but bare wires — and element
 * symbols are most of what ends up in the file.)
 */

import { describe, expect, it } from 'vitest';
import { compile } from '../../src/compiler';
import { buildExportDxf } from '../../src/lib/export-dxf';
import type { Annotation, DiagramFile } from '../../src/model';

/** Split the flat DXF stream into (code, value) pairs. */
function pairs(dxf: string): [number, string][] {
  const lines = dxf.split('\n');
  const out: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    out.push([Number(lines[i].trim()), lines[i + 1].trim()]);
  }
  return out;
}

/** Header variable lookup: `9\n$NAME` followed by its value codes. */
function headerVar(dxf: string, name: string): [number, string][] | null {
  const ps = pairs(dxf);
  const i = ps.findIndex(([c, v]) => c === 9 && v === name);
  if (i < 0) return null;
  const out: [number, string][] = [];
  for (let j = i + 1; j < ps.length && ps[j][0] !== 9 && ps[j][0] !== 0; j++) out.push(ps[j]);
  return out;
}

const twoBreakers: DiagramFile = {
  version: '1',
  elements: [
    { id: 'QF1', kind: 'breaker' },
    { id: 'QF2', kind: 'breaker' },
  ],
  layout: { QF1: { at: [100, 100] }, QF2: { at: [100, 400] } },
  wires: [{ id: 'w1', ends: ['QF1.t2', 'QF2.t1'] }],
};

const dxfFor = (d: DiagramFile, annotations?: Annotation[]): string =>
  buildExportDxf(compile(d), annotations ? { annotations } : {});

describe('DXF is the version it claims to be', () => {
  it('declares R12 and emits no entity newer than R12', () => {
    const dxf = dxfFor(twoBreakers);
    expect(headerVar(dxf, '$ACADVER')).toEqual([[1, 'AC1009']]);
    // The whole bug in one assertion.
    expect(dxf).not.toContain('LWPOLYLINE');
  });

  it('writes each polyline as a well-formed R12 vertex sequence', () => {
    const ps = pairs(dxfFor(twoBreakers));
    const start = ps.findIndex(([c, v]) => c === 0 && v === 'POLYLINE');
    expect(start).toBeGreaterThanOrEqual(0);

    // 66 = "vertices follow". Without it a reader has no reason to expect the
    // VERTEX records, which is how geometry goes missing while the file still
    // parses.
    const body = ps.slice(start + 1, start + 8);
    expect(body).toContainEqual([66, '1']);

    // ...and the run must be terminated, or the next entity is swallowed.
    let i = start + 1;
    let vertices = 0;
    for (; i < ps.length && !(ps[i][0] === 0 && ps[i][1] === 'SEQEND'); i++) {
      if (ps[i][0] === 0 && ps[i][1] === 'VERTEX') vertices++;
    }
    expect(vertices).toBeGreaterThanOrEqual(2);
    expect(ps[i]).toEqual([0, 'SEQEND']);
  });

  it('keeps every wire and bus, which is what a header-honouring reader dropped', () => {
    const withBus: DiagramFile = {
      ...twoBreakers,
      buses: [{ id: 'B1', layout: { at: [100, 700], span: 400 } }],
      wires: [
        { id: 'w1', ends: ['QF1.t2', 'QF2.t1'] },
        { id: 'w2', ends: ['QF2.t2', 'B1'] },
      ],
    };
    const ps = pairs(dxfFor(withBus));
    // Every POLYLINE start is followed by its layer.
    const layers = ps
      .map(([c, v], i) => (c === 0 && v === 'POLYLINE' ? ps[i + 1][1] : null))
      .filter(Boolean);
    expect(layers.filter((l) => l === 'WIRES').length).toBeGreaterThanOrEqual(3);
  });

  it('preserves the closed flag, so a box is a box and not an open path', () => {
    const rect = [
      { id: 'A1', type: 'rect', at: [0, 0], size: [200, 120], label: 'CABINET' },
    ] as unknown as Annotation[];
    const ps = pairs(dxfFor(twoBreakers, rect));
    const closed = ps
      .map(([c, v], i) => (c === 0 && v === 'POLYLINE' ? ps.slice(i + 1, i + 6) : null))
      .filter(Boolean)
      .filter((body) => body!.some(([c, v]) => c === 70 && v === '1'));
    expect(closed.length).toBeGreaterThanOrEqual(1);
  });
});

describe('DXF says where the drawing is', () => {
  // Without stored extents and with no VPORT table, a CAD app opens on a
  // default window near the origin. SLDs sit at negative Y and can run past
  // x = 1900, i.e. entirely off-screen — the *other* thing "blank" means.
  it('declares extents that actually contain the geometry', () => {
    const dxf = dxfFor(twoBreakers);
    const min = headerVar(dxf, '$EXTMIN');
    const max = headerVar(dxf, '$EXTMAX');
    expect(min).not.toBeNull();
    expect(max).not.toBeNull();

    const [minX, minY] = min!.filter(([c]) => c === 10 || c === 20).map(([, v]) => Number(v));
    const [maxX, maxY] = max!.filter(([c]) => c === 10 || c === 20).map(([, v]) => Number(v));
    expect(maxX).toBeGreaterThan(minX);
    expect(maxY).toBeGreaterThan(minY);

    // Every vertex must fall inside the box we advertise.
    const ps = pairs(dxf);
    for (let i = 0; i < ps.length; i++) {
      if (ps[i][0] !== 0 || ps[i][1] !== 'VERTEX') continue;
      const x = Number(ps.slice(i, i + 6).find(([c]) => c === 10)![1]);
      const y = Number(ps.slice(i, i + 6).find(([c]) => c === 20)![1]);
      expect(x).toBeGreaterThanOrEqual(minX - 1e-6);
      expect(x).toBeLessThanOrEqual(maxX + 1e-6);
      expect(y).toBeGreaterThanOrEqual(minY - 1e-6);
      expect(y).toBeLessThanOrEqual(maxY + 1e-6);
    }
  });

  it('omits extents entirely for an empty drawing rather than inventing them', () => {
    // A fabricated rectangle is worse than none: it strands the viewport
    // somewhere with nothing in it.
    const dxf = dxfFor({ version: '1', elements: [] });
    expect(headerVar(dxf, '$EXTMIN')).toBeNull();
    expect(headerVar(dxf, '$EXTMAX')).toBeNull();
    expect(dxf).toContain('AC1009');
  });

  it('never emits a NaN or Infinity coordinate', () => {
    const dxf = dxfFor(twoBreakers);
    expect(dxf).not.toMatch(/\bNaN\b/);
    expect(dxf).not.toMatch(/\bInfinity\b/);
  });
});
