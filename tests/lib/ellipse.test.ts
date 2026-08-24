/**
 * Ellipse geometry and its export paths.
 *
 * The ellipse is stored as a bounding box so it can reuse every box-shaped
 * affordance rects already had; these tests pin that equivalence (bbox, grips,
 * marquee) and the DXF approximation, which exists because R12 has no ELLIPSE
 * entity — the same version trap that once made every exported file blank.
 *
 * @vitest-environment jsdom
 *
 * (jsdom for the DXF writer's `DOMParser` symbol expansion.)
 */

import { describe, expect, it } from 'vitest';
import { compile } from '../../src/compiler';
import {
  annotationBBox,
  ellipseGeom,
  ellipsePolygon,
} from '../../src/lib/annotation-geom';
import { buildExportSvg } from '../../src/lib/export-image';
import { buildExportDxf } from '../../src/lib/export-dxf';
import { hitsInRect } from '../../src/canvas/marquee-hit';
import type {
  Annotation,
  DiagramFile,
  EllipseAnnotation,
} from '../../src/model';

const EMPTY: DiagramFile = { version: '1', elements: [] };

const ELLIPSE: EllipseAnnotation = {
  id: 'e1',
  type: 'ellipse',
  at: [100, 200],
  size: [80, 40],
};

describe('geometry', () => {
  it('converts a bounding box to centre + radii', () => {
    expect(ellipseGeom(ELLIPSE)).toEqual({ cx: 140, cy: 220, rx: 40, ry: 20 });
  });

  it('bounds exactly like the rect with the same box', () => {
    const rect: Annotation = {
      id: 'r1',
      type: 'rect',
      at: ELLIPSE.at,
      size: ELLIPSE.size,
    };
    expect(annotationBBox(ELLIPSE)).toEqual(annotationBBox(rect));
  });

  it('is caught by a marquee over its box', () => {
    const hits = hitsInRect(compile(EMPTY), [ELLIPSE], {
      x: 90,
      y: 190,
      w: 20,
      h: 20,
    });
    expect(hits.annotations).toEqual(['e1']);
  });

  it('is not caught by a marquee that misses its box', () => {
    const hits = hitsInRect(compile(EMPTY), [ELLIPSE], {
      x: 0,
      y: 0,
      w: 10,
      h: 10,
    });
    expect(hits.annotations).toEqual([]);
  });
});

describe('polygonal approximation (for writers with no ellipse primitive)', () => {
  it('stays on the ellipse', () => {
    // Every vertex must satisfy (x-cx)²/rx² + (y-cy)²/ry² = 1.
    const { cx, cy, rx, ry } = ellipseGeom(ELLIPSE);
    for (const [x, y] of ellipsePolygon(ELLIPSE)) {
      const r = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      expect(r).toBeCloseTo(1, 10);
    }
  });

  it('does not repeat the closing vertex (the writer closes the loop)', () => {
    const pts = ellipsePolygon(ELLIPSE, 8);
    expect(pts).toHaveLength(8);
    expect(pts[0]).not.toEqual(pts[7]);
  });
});

describe('export', () => {
  it('emits a real <ellipse> in SVG', () => {
    const svg = buildExportSvg(compile(EMPTY), { annotations: [ELLIPSE] });
    expect(svg).toContain('<ellipse');
    expect(svg).toContain('cx="140"');
    expect(svg).toContain('rx="40"');
  });

  it('emits a POLYLINE in DXF and never the R13-only ELLIPSE entity', () => {
    const dxf = buildExportDxf(compile(EMPTY), { annotations: [ELLIPSE] });
    expect(dxf).toContain('POLYLINE');
    // `ELLIPSE` post-dates the AC1009 header this writer declares. Emitting
    // it is the LWPOLYLINE mistake all over again.
    expect(dxf).not.toMatch(/^\s*ELLIPSE\s*$/m);
  });

  it('carries its label into both formats', () => {
    const labelled = { ...ELLIPSE, label: 'ZONE A' };
    expect(buildExportSvg(compile(EMPTY), { annotations: [labelled] })).toContain(
      'ZONE A',
    );
    expect(buildExportDxf(compile(EMPTY), { annotations: [labelled] })).toContain(
      'ZONE A',
    );
  });
});
