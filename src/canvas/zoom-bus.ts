/**
 * Tiny pub/sub for the live viewport scale. Lets chrome (TopBar zoom %) read
 * the value without forcing the gesture path through React state. Updated
 * by `useViewport` after every transform change.
 */

type Listener = (scale: number) => void;

let current = 1;
const listeners = new Set<Listener>();

export function publishScale(scale: number): void {
  if (scale === current) return;
  current = scale;
  for (const l of listeners) l(scale);
}

export function getScale(): number {
  return current;
}

export function subscribeScale(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
