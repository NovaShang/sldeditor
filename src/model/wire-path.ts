/**
 * Wire path normalization. The Wire.path field accepts any polyline, but
 * the editor's invariants assume the path is orthogonal (segments are H or V)
 * and free of redundant points. This module enforces those invariants.
 *
 * normalizePath is called from `store.updateWirePath` (so user edits stay
 * clean) and from the compiler when materializing a Wire.path into a
 * WireRender (so legacy / persisted dirty paths render correctly).
 *
 * Operations:
 *  - drop consecutive duplicates
 *  - insert an L-corner on any diagonal segment (vertical-first, matching
 *    the auto-router's convention)
 *  - collapse collinear interior points (three points sharing an x or y)
 */

type Pt = [number, number];

const EPS = 0.5;

export function normalizePath(path: readonly Pt[]): Pt[] {
  if (path.length < 2) return path.map((p) => [p[0], p[1]] as Pt);

  // Step 1: dedupe consecutive coincident points.
  const dedup: Pt[] = [[path[0][0], path[0][1]]];
  for (let i = 1; i < path.length; i++) {
    const last = dedup[dedup.length - 1];
    if (Math.abs(last[0] - path[i][0]) < EPS && Math.abs(last[1] - path[i][1]) < EPS) continue;
    dedup.push([path[i][0], path[i][1]]);
  }
  if (dedup.length < 2) return dedup;

  // Step 2: turn any diagonal segment into an L-corner. The first leg goes
  // along the prior axis (so corners feel like continuations of the
  // previous segment); fall back to vertical-first when there's no prior
  // segment (matches `auto-route.ts:orthogonalPath`).
  const orthog: Pt[] = [dedup[0]];
  for (let i = 1; i < dedup.length; i++) {
    const prev = orthog[orthog.length - 1];
    const cur = dedup[i];
    const dx = Math.abs(prev[0] - cur[0]);
    const dy = Math.abs(prev[1] - cur[1]);
    if (dx > EPS && dy > EPS) {
      const priorAxis: 'h' | 'v' | null =
        orthog.length >= 2
          ? Math.abs(orthog[orthog.length - 2][1] - prev[1]) < EPS
            ? 'h'
            : 'v'
          : null;
      const corner: Pt =
        priorAxis === 'h' ? [cur[0], prev[1]] : [prev[0], cur[1]];
      orthog.push(corner);
    }
    orthog.push(cur);
  }

  // Step 3: drop interior points that lie on the line between their
  // neighbors (same x for both neighbor segments, or same y).
  const out: Pt[] = [orthog[0]];
  for (let i = 1; i < orthog.length - 1; i++) {
    const prev = out[out.length - 1];
    const cur = orthog[i];
    const next = orthog[i + 1];
    const sameX = Math.abs(prev[0] - cur[0]) < EPS && Math.abs(cur[0] - next[0]) < EPS;
    const sameY = Math.abs(prev[1] - cur[1]) < EPS && Math.abs(cur[1] - next[1]) < EPS;
    if (sameX || sameY) continue;
    out.push(cur);
  }
  out.push(orthog[orthog.length - 1]);
  return out;
}
