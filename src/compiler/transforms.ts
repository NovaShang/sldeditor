/**
 * Geometric transforms for placing library-local coordinates onto the canvas.
 * Order applied to a local point: mirror (about y-axis) → rotate → translate.
 * The same convention drives ElementLayer's SVG `transform` attribute, so
 * SVG output and computed terminal coords stay in sync.
 */

import type { Orientation } from '@/model';
import type { ResolvedPlacement } from './internal-model';

export function transformPoint(
  local: [number, number],
  p: ResolvedPlacement,
): [number, number] {
  let [x, y] = local;
  if (p.mirror) x = -x;
  switch (p.rot) {
    case 0:
      break;
    case 90:
      [x, y] = [-y, x];
      break;
    case 180:
      [x, y] = [-x, -y];
      break;
    case 270:
      [x, y] = [y, -x];
      break;
  }
  return [x + p.at[0], y + p.at[1]];
}

const ROT_NEXT: Record<Orientation, Orientation> = {
  n: 'e',
  e: 's',
  s: 'w',
  w: 'n',
};

const MIRROR_X: Record<Orientation, Orientation> = {
  n: 'n',
  s: 's',
  e: 'w',
  w: 'e',
};

export function transformOrientation(
  o: Orientation,
  p: ResolvedPlacement,
): Orientation {
  let cur: Orientation = p.mirror ? MIRROR_X[o] : o;
  const steps = (p.rot / 90) | 0;
  for (let i = 0; i < steps; i++) cur = ROT_NEXT[cur];
  return cur;
}

/** Unit vector pointing the way an exit-line should leave a terminal. */
export function orientationVec(o: Orientation): [number, number] {
  switch (o) {
    case 'n':
      return [0, -1];
    case 's':
      return [0, 1];
    case 'e':
      return [1, 0];
    case 'w':
      return [-1, 0];
  }
}
