import type { Junction, Wire } from '../model';

/**
 * Drop junctions that an edit just orphaned. A junction that was an endpoint of
 * a removed wire and now has no remaining wire is meaningless, so prune it.
 * Junctions that were never wired (placed standalone) and junctions that still
 * have another connection are left untouched.
 *
 * @param oldWires        wires before the edit
 * @param remainingWires  wires after the edit (subset of oldWires by id)
 * @param junctions       junctions after any explicit removals
 */
export function pruneOrphanedJunctions(
  oldWires: Wire[],
  remainingWires: Wire[],
  junctions: Junction[],
): Junction[] {
  if (junctions.length === 0) return junctions;
  const junctionIds = new Set(junctions.map((j) => j.id));
  const remainingWireIds = new Set(remainingWires.map((w) => w.id));

  // Junction ids that lost a wire in this edit.
  const touched = new Set<string>();
  for (const w of oldWires) {
    if (remainingWireIds.has(w.id)) continue;
    for (const end of w.ends) if (junctionIds.has(end)) touched.add(end);
  }
  if (touched.size === 0) return junctions;

  // Of those, which still have a remaining wire?
  const stillConnected = new Set<string>();
  for (const w of remainingWires) {
    for (const end of w.ends) if (touched.has(end)) stillConnected.add(end);
  }
  return junctions.filter((j) => !touched.has(j.id) || stillConnected.has(j.id));
}
