/**
 * Pub/sub for the in-progress wire target. WireTool publishes the current
 * candidate (a real terminal or a bus virtual-tap projection); WirePreview
 * subscribes and renders an indicator so the user sees *where* a release
 * would land before they release.
 */

import type { TerminalRef } from '@/model';

export interface WireTarget {
  ref: TerminalRef;
  /** World-frame coords of where the connection will physically attach. */
  world: [number, number];
  /** True when the target is a bus virtual `tap` (not a literal terminal). */
  isBusTap: boolean;
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
