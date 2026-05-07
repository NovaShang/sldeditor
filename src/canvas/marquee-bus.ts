/**
 * Tiny pub/sub for the marquee selection rect (in SVG coords). Used by
 * SelectTool to publish rect updates and by `<MarqueeOverlay>` to render
 * without bouncing through the editor store.
 */

export interface MarqueeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Listener = (rect: MarqueeRect | null) => void;

let current: MarqueeRect | null = null;
const listeners = new Set<Listener>();

export function publishMarquee(rect: MarqueeRect | null): void {
  current = rect;
  for (const l of listeners) l(rect);
}

export function getMarquee(): MarqueeRect | null {
  return current;
}

export function subscribeMarquee(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
