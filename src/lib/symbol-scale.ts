/**
 * Keep a scaled symbol's line weight equal to the rest of the drawing.
 *
 * A placement's `scale` is applied as an SVG `scale()` on the symbol group,
 * which would also thicken (or thin) every stroke inside it — a 2× transformer
 * drawn with double-weight lines next to its 1× neighbours. CAD keeps line
 * weight independent of block scale, and so do we: the library SVG's
 * `stroke-width` attributes are divided by the scale so they come out at their
 * authored world width after the group transform.
 *
 * Library symbols are build-time content with plain numeric `stroke-width`
 * attributes, so a string rewrite is exact. Results are memoised per
 * (svg, scale) — the canvas re-renders a symbol many times per drag.
 */

const cache = new Map<string, string>();

export function compensateStrokes(svg: string, scale: number | undefined): string {
  const s = scale ?? 1;
  if (s === 1 || !svg) return svg;
  const key = `${s}\u0000${svg}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const out = svg.replace(
    /stroke-width="([0-9.]+)"/g,
    (_, w: string) => `stroke-width="${round(Number(w) / s)}"`,
  );
  if (cache.size > 500) cache.clear();
  cache.set(key, out);
  return out;
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}
