/**
 * Pub/sub for the cursor's hover target on the canvas. `useHoverHighlight`
 * publishes the current `data-element-id` (or null when leaving an element);
 * `ElementHoverLabel` subscribes to render a small floating name tag.
 */

import type { ElementId } from '../model';

type Listener = (id: ElementId | null) => void;

let current: ElementId | null = null;
const listeners = new Set<Listener>();

export function publishHoverElement(id: ElementId | null): void {
  if (id === current) return;
  current = id;
  for (const l of listeners) l(id);
}

export function getHoverElement(): ElementId | null {
  return current;
}

export function subscribeHoverElement(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
