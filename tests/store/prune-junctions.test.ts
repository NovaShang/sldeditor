/**
 * Deleting a wire (or an element/node that removes wires) should auto-delete any
 * junction it leaves orphaned — but never a still-connected one or a standalone
 * one the user placed deliberately.
 */
import { describe, expect, it } from 'vitest';
import { pruneOrphanedJunctions } from '../../src/store/prune-junctions';
import type { Junction, Wire } from '../../src/model';

const wire = (id: string, a: string, b: string): Wire =>
  ({ id, ends: [a, b] }) as Wire;
const junction = (id: string): Junction =>
  ({ id, layout: { at: [0, 0] } }) as Junction;

describe('pruneOrphanedJunctions', () => {
  it('drops a junction orphaned by removing its only wire', () => {
    const old = [wire('w1', 'QF1.t2', 'J1')];
    expect(pruneOrphanedJunctions(old, [], [junction('J1')])).toEqual([]);
  });

  it('keeps a junction that still has another wire', () => {
    const old = [wire('w1', 'QF1.t2', 'J1'), wire('w2', 'J1', 'QF2.t1')];
    const remaining = [wire('w2', 'J1', 'QF2.t1')];
    expect(
      pruneOrphanedJunctions(old, remaining, [junction('J1')]).map((j) => j.id),
    ).toEqual(['J1']);
  });

  it('leaves a standalone (never-wired) junction untouched', () => {
    const old = [wire('w1', 'A.t1', 'B.t1')];
    expect(
      pruneOrphanedJunctions(old, [], [junction('J2')]).map((j) => j.id),
    ).toEqual(['J2']);
  });

  it('drops a junction only once all of its wires are removed', () => {
    const old = [wire('w1', 'A.t', 'J1'), wire('w2', 'J1', 'B.t')];
    // remove only w1 → still connected by w2
    expect(
      pruneOrphanedJunctions(old, [wire('w2', 'J1', 'B.t')], [junction('J1')]).map(
        (j) => j.id,
      ),
    ).toEqual(['J1']);
    // remove both → orphaned
    expect(pruneOrphanedJunctions(old, [], [junction('J1')])).toEqual([]);
  });

  it('prunes only the orphaned junction in a mixed set', () => {
    const old = [wire('w1', 'A.t', 'J1'), wire('w2', 'J2', 'B.t')];
    // remove w1 only → J1 orphaned, J2 untouched
    const out = pruneOrphanedJunctions(
      old,
      [wire('w2', 'J2', 'B.t')],
      [junction('J1'), junction('J2')],
    ).map((j) => j.id);
    expect(out).toEqual(['J2']);
  });

  it('is a no-op when there are no junctions', () => {
    const old = [wire('w1', 'A.t', 'B.t')];
    expect(pruneOrphanedJunctions(old, [], [])).toEqual([]);
  });
});
