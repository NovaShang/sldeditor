/**
 * A group move translates the whole region: manual wire routes travel with it
 * when *both* of their endpoints are moving, and stay put when only one is.
 *
 * The asymmetry is the point. `Wire.path` waypoints are absolute and the
 * compiler rebases only the first/last point onto the live endpoints, so a
 * detour that isn't translated stays pinned where it was while the devices
 * slide past it — and `normalizePath` keeps the result orthogonal, so it
 * looks like a plausible route rather than obvious breakage.
 */

import { describe, expect, it } from 'vitest';
import {
  endOwner,
  translateManualWirePaths,
} from '../../src/store/group-move';
import type { ElementId, Wire } from '../../src/model';

const DETOUR: [number, number][] = [
  [0, 20],
  [400, 20],
  [400, 100],
  [120, 100],
];

const wire = (path?: [number, number][]): Wire => ({
  id: 'w1',
  ends: ['QF1.t2', 'QF2.t1'],
  ...(path ? { path } : {}),
});

const deltas = (entries: [ElementId, [number, number]][]) =>
  new Map<ElementId, [number, number]>(entries);

describe('endOwner', () => {
  it('strips the pin from a device terminal', () => {
    expect(endOwner('QF1.t2')).toBe('QF1');
  });

  it('passes a bare bus / junction id through', () => {
    expect(endOwner('B1')).toBe('B1');
    expect(endOwner('J1')).toBe('J1');
  });
});

describe('translateManualWirePaths', () => {
  it('translates waypoints when both ends move by the same delta', () => {
    const out = translateManualWirePaths(
      [wire(DETOUR)],
      deltas([
        ['QF1', [300, 0]],
        ['QF2', [300, 0]],
      ]),
    );
    expect(out?.[0].path).toEqual([
      [300, 20],
      [700, 20],
      [700, 100],
      [420, 100],
    ]);
  });

  it('leaves waypoints alone when only one end moves', () => {
    const wires = [wire(DETOUR)];
    const out = translateManualWirePaths(wires, deltas([['QF1', [300, 0]]]));
    // Same array identity — nothing to rewrite, so the document is untouched.
    expect(out).toBe(wires);
    expect(out?.[0].path).toEqual(DETOUR);
  });

  it('leaves waypoints alone when the two ends move by different deltas', () => {
    const wires = [wire(DETOUR)];
    const out = translateManualWirePaths(
      wires,
      deltas([
        ['QF1', [300, 0]],
        ['QF2', [0, 300]],
      ]),
    );
    expect(out).toBe(wires);
  });

  it('ignores auto-routed wires (no stored path)', () => {
    const wires = [wire()];
    const out = translateManualWirePaths(
      wires,
      deltas([
        ['QF1', [10, 10]],
        ['QF2', [10, 10]],
      ]),
    );
    expect(out).toBe(wires);
    expect(out?.[0].path).toBeUndefined();
  });

  it('ignores a two-point path — the compiler rebases both ends anyway', () => {
    const wires = [
      wire([
        [0, 0],
        [50, 0],
      ]),
    ];
    const out = translateManualWirePaths(
      wires,
      deltas([
        ['QF1', [10, 10]],
        ['QF2', [10, 10]],
      ]),
    );
    expect(out).toBe(wires);
  });

  it('follows bus and junction endpoints, not just device pins', () => {
    const w: Wire = { id: 'w2', ends: ['B1', 'J1'], path: DETOUR };
    const out = translateManualWirePaths(
      [w],
      deltas([
        ['B1', [0, -40]],
        ['J1', [0, -40]],
      ]),
    );
    expect(out?.[0].path).toEqual([
      [0, -20],
      [400, -20],
      [400, 60],
      [120, 60],
    ]);
  });

  it('translates a self-loop wire whose two ends share one element', () => {
    const w: Wire = { id: 'w3', ends: ['QF1.t1', 'QF1.t2'], path: DETOUR };
    const out = translateManualWirePaths([w], deltas([['QF1', [5, 5]]]));
    expect(out?.[0].path?.[0]).toEqual([5, 25]);
  });

  it('is a no-op for an empty move', () => {
    const wires = [wire(DETOUR)];
    expect(translateManualWirePaths(wires, deltas([]))).toBe(wires);
    expect(translateManualWirePaths(undefined, deltas([['QF1', [1, 1]]]))).toBe(
      undefined,
    );
  });
});
