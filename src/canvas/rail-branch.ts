/**
 * Route for a wire pulled out of a supply rail (circuit diagrams). The branch
 * leaves the rail at right angles from the pressed point — down / up out of
 * a horizontal rail, left / right out of a vertical one — so the tap sits
 * where the user pressed, then turns once to run parallel to the rail into
 * the landing. A pin that faces back toward the rail across that last run
 * (an up-facing pin below a horizontal rail, a left-facing pin right of a
 * vertical one) is entered head-on instead, with a jog half-way out.
 *
 * Shared by the drag preview and the release, so what the user sees while
 * dragging is exactly the wire that gets stored.
 */

import type { Orientation } from '../model';
import { snap } from './grid';

type Pt = [number, number];

export interface RailBranchLanding {
  world: Pt;
  isBus: boolean;
  /** Which way the landing pin faces, when the landing is a device pin. */
  orientation?: Orientation;
}

/**
 * `axis` is the rail's own direction (`'x'` horizontal, `'y'` vertical).
 * Undefined — the router's own line — when the landing is another rail, or
 * sits straight out from the pressed point (one segment says it all), or on
 * the rail's own line.
 */
export function railBranchPath(
  press: Pt,
  axis: 'x' | 'y',
  to: RailBranchLanding,
): Pt[] | undefined {
  if (to.isBus) return undefined;
  const t = to.world;
  // u: along the rail; v: out of it.
  const u = axis === 'x' ? 0 : 1;
  const v = 1 - u;
  if (t[u] === press[u] || t[v] === press[v]) return undefined;
  const at = (uu: number, vv: number): Pt => (u === 0 ? [uu, vv] : [vv, uu]);
  const out = Math.sign(t[v] - press[v]);
  // The pin faces back toward the rail (its exit points against `out`).
  const facesRail =
    axis === 'x'
      ? (to.orientation === 'n' && out > 0) || (to.orientation === 's' && out < 0)
      : (to.orientation === 'w' && out > 0) || (to.orientation === 'e' && out < 0);
  if (facesRail) {
    const mid = snap((press[v] + t[v]) / 2);
    return [press, at(press[u], mid), at(t[u], mid), t];
  }
  return [press, at(press[u], t[v]), t];
}
