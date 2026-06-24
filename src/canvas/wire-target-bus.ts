/**
 * Pub/sub for the in-progress wire target. WireTool publishes the current
 * candidate (a real terminal or a bus body projection); WirePreview
 * subscribes and renders an indicator so the user sees *where* a release
 * would land before they release.
 */

import type { WireEnd } from '../model';

export interface WireTarget {
  /** Existing connectable ref, or null when this target will mint a junction. */
  ref: WireEnd | null;
  /** World-frame coords of where the connection will physically attach. */
  world: [number, number];
  /** True when the target is a bare bus id. */
  isBus: boolean;
  /** Set when releasing here mints a junction (empty space, or a wire tap). */
  create?: 'junction';
}

type Listener = (target: WireTarget | null) => void;

let current: WireTarget | null = null;
const listeners = new Set<Listener>();

export function publishWireTarget(t: WireTarget | null): void {
  if (
    (t === null && current === null) ||
    (t &&
      current &&
      t.ref === current.ref &&
      t.world[0] === current.world[0] &&
      t.world[1] === current.world[1])
  ) {
    return;
  }
  current = t;
  for (const l of listeners) l(t);
}

export function getWireTarget(): WireTarget | null {
  return current;
}

export function subscribeWireTarget(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
