/**
 * Wire-crossing hops: where two wires cross without connecting, one of them
 * draws a small arc over the other.
 *
 * The rules pinned here are the ones a reader of the drawing relies on:
 *   - only a strictly interior crossing hops — a tee (one wire ending on
 *     another) and a shared endpoint are connections, never hops;
 *   - a crossing on a junction dot never hops (the dot says "joined");
 *   - at a horizontal/vertical crossing the vertical wire hops; any other
 *     pair hops the wire later in the document;
 *   - the setting is per document and absent = off, so a drawing written
 *     before hops existed compiles to exactly the paths it always did.
 *
 * @vitest-environment jsdom
 *
 * (jsdom because the DXF writer parses each symbol's SVG with `DOMParser`.)
 */

import { describe, expect, it } from 'vitest';
import {
  computeWireHops,
  findWireCrossings,
  HOP_RADIUS,
  hoppedPath,
} from '../../src/lib/wire-hops';
import { compile } from '../../src/compiler';
import { buildExportSvg } from '../../src/lib/export-image';
import { buildExportDxf } from '../../src/lib/export-dxf';
import type { DiagramFile } from '../../src/model';

type Pt = [number, number];
const run = (id: string, ...path: Pt[]) => ({ id, path });

describe('findWireCrossings', () => {
  it('finds a plain horizontal/vertical crossing', () => {
    const xs = findWireCrossings([
      run('h', [0, 50], [100, 50]),
      run('v', [40, 0], [40, 100]),
    ]);
    expect(xs).toHaveLength(1);
    expect(xs[0].at).toEqual([40, 50]);
  });

  it('ignores a tee — a wire ending on another is a connection', () => {
    expect(
      findWireCrossings([run('h', [0, 50], [100, 50]), run('v', [40, 0], [40, 50])]),
    ).toEqual([]);
  });

  it('ignores wires that only share an endpoint', () => {
    expect(
      findWireCrossings([run('a', [0, 0], [50, 0]), run('b', [50, 0], [50, 80])]),
    ).toEqual([]);
  });

  it('ignores a crossing that sits on a junction dot', () => {
    expect(
      findWireCrossings(
        [run('h', [0, 50], [100, 50]), run('v', [40, 0], [40, 100])],
        [[40, 50]],
      ),
    ).toEqual([]);
  });

  it('ignores parallel and collinear runs', () => {
    expect(
      findWireCrossings([run('a', [0, 0], [100, 0]), run('b', [20, 0], [80, 0])]),
    ).toEqual([]);
  });

  it('handles a diagonal against an orthogonal run', () => {
    const xs = findWireCrossings([
      run('h', [0, 50], [100, 50]),
      run('d', [0, 0], [100, 100]),
    ]);
    expect(xs).toHaveLength(1);
    expect(xs[0].at[0]).toBeCloseTo(50);
    expect(xs[0].at[1]).toBeCloseTo(50);
  });

  it('never crosses a wire with itself', () => {
    expect(
      findWireCrossings([run('a', [0, 50], [100, 50], [100, 0], [50, 0], [50, 100])]),
    ).toEqual([]);
  });
});

describe('computeWireHops', () => {
  it('hops the vertical wire at a horizontal/vertical crossing, whatever the order', () => {
    const a = computeWireHops([run('v', [40, 0], [40, 100]), run('h', [0, 50], [100, 50])]);
    expect([...a.keys()]).toEqual(['v']);
    const b = computeWireHops([run('h', [0, 50], [100, 50]), run('v', [40, 0], [40, 100])]);
    expect([...b.keys()]).toEqual(['v']);
    expect(b.get('v')?.get(0)).toEqual([[40, 50]]);
  });

  it('hops the later wire when neither is vertical', () => {
    const hops = computeWireHops([
      run('first', [0, 0], [100, 100]),
      run('second', [0, 100], [100, 0]),
    ]);
    expect([...hops.keys()]).toEqual(['second']);
  });
});

describe('hoppedPath', () => {
  it('bulges a vertical run sideways by the hop radius at the crossing', () => {
    const out = hoppedPath([[40, 0], [40, 100]], new Map([[0, [[40, 50] as Pt]]]));
    expect(out[0]).toEqual([40, 0]);
    expect(out[out.length - 1]).toEqual([40, 100]);
    const maxOff = Math.max(...out.map((p) => Math.abs(p[0] - 40)));
    expect(maxOff).toBeCloseTo(HOP_RADIUS);
    // The arc spans exactly the crossing ± radius along the wire.
    const arc = out.filter((p) => Math.abs(p[0] - 40) > 1e-9);
    expect(Math.min(...arc.map((p) => p[1]))).toBeGreaterThan(50 - HOP_RADIUS);
    expect(Math.max(...arc.map((p) => p[1]))).toBeLessThan(50 + HOP_RADIUS);
  });

  it('bulges a horizontal run upward', () => {
    const out = hoppedPath([[0, 50], [100, 50]], new Map([[0, [[30, 50] as Pt]]]));
    expect(Math.min(...out.map((p) => p[1]))).toBeCloseTo(50 - HOP_RADIUS);
    expect(Math.max(...out.map((p) => p[1]))).toBe(50);
  });

  it('merges hops closer than one arc into a single wider arc', () => {
    const out = hoppedPath(
      [[0, 50], [100, 50]],
      new Map([[0, [[30, 50], [34, 50]] as Pt[]]]),
    );
    // One contiguous raised stretch, not two arcs that dip back to the line.
    const raised = out.map((p) => p[1] < 50 - 1e-9);
    const firstUp = raised.indexOf(true);
    const lastUp = raised.lastIndexOf(true);
    expect(raised.slice(firstUp, lastUp + 1).every(Boolean)).toBe(true);
  });

  it('leaves a path with no hops untouched', () => {
    const path: Pt[] = [[0, 0], [0, 50], [80, 50]];
    expect(hoppedPath(path, new Map())).toEqual(path);
  });
});

// Two free runs crossing between explicitly placed junctions — the smallest
// drawing with an unconnected crossing, and one whose geometry the compiler
// cannot re-route (junction layouts render verbatim).
const CROSSING: DiagramFile = {
  version: '1',
  elements: [],
  junctions: [
    { id: 'J1', layout: { at: [0, 80] } },
    { id: 'J2', layout: { at: [200, 80] } },
    { id: 'J3', layout: { at: [100, 0] } },
    { id: 'J4', layout: { at: [100, 160] } },
  ],
  wires: [
    { id: 'wh', ends: ['J1', 'J2'] },
    { id: 'wv', ends: ['J3', 'J4'] },
  ],
};

describe('document setting', () => {
  it('is off when absent: compiled wires carry no hop geometry', () => {
    const m = compile(CROSSING);
    for (const r of m.wireRenders.values()) expect(r.drawn).toBeUndefined();
  });

  it('when on, gives the hopping wire a drawn path and leaves the other alone', () => {
    const m = compile({ ...CROSSING, meta: { wireHops: true } });
    const wv = m.wireRenders.get('wv')!;
    const wh = m.wireRenders.get('wh')!;
    expect(wh.drawn).toBeUndefined();
    expect(wv.drawn).toBeDefined();
    expect(wv.drawn!.length).toBeGreaterThan(wv.path.length);
    // The logical path (hit-testing, labels, editing) is never altered.
    expect(wv.path.length).toBe(2);
  });

  it('reaches the SVG and DXF exports', () => {
    const off = compile(CROSSING);
    const on = compile({ ...CROSSING, meta: { wireHops: true } });
    const svgOff = buildExportSvg(off);
    const svgOn = buildExportSvg(on);
    expect(svgOn).not.toEqual(svgOff);
    const drawn = on.wireRenders.get('wv')!.drawn!;
    expect(svgOn).toContain(drawn.map(([x, y]) => `${x},${y}`).join(' '));

    const vertexCount = (dxf: string) => (dxf.match(/^VERTEX$/gm) ?? []).length;
    expect(vertexCount(buildExportDxf(on))).toBeGreaterThan(
      vertexCount(buildExportDxf(off)),
    );
  });
});

describe('performance', () => {
  it('handles a 1,200-wire drawing quickly', () => {
    // 600 horizontal and 600 vertical wires on a 20-unit pitch, each 400
    // units long and staggered so every wire crosses ~20 others: ~12k
    // crossings among 1,200 wires — denser than any real sheet.
    const runs: { id: string; path: Pt[] }[] = [];
    for (let i = 0; i < 600; i++) {
      const x0 = (i % 30) * 200;
      const y = Math.floor(i / 30) * 20 + 5;
      runs.push(run(`h${i}`, [x0, y], [x0 + 400, y]));
    }
    for (let i = 0; i < 600; i++) {
      const x = (i % 300) * 20 + 7;
      const y0 = Math.floor(i / 300) * 200;
      runs.push(run(`v${i}`, [x, y0], [x, y0 + 400]));
    }
    const t0 = performance.now();
    const hops = computeWireHops(runs);
    const ms = performance.now() - t0;
    let n = 0;
    for (const bySeg of hops.values()) for (const pts of bySeg.values()) n += pts.length;
    expect(n).toBeGreaterThan(5000);
    expect(ms).toBeLessThan(250);
  });
});
