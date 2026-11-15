/**
 * Text inside a symbol's own SVG — the "V" in a voltmeter, the "IΔn" a
 * document-defined RCD prints in its body.
 *
 * Two problems, both of which only show up away from the default case:
 *
 *   1. Mirroring. A placement's `mirror` is a `scale(-1 1)` on the symbol
 *      group, which reverses every glyph with it, so a flipped symbol read
 *      its own text backwards. `uprightSymbolText` counter-flips each `<text>`
 *      about its own anchor and swaps `text-anchor` start↔end, so the text box
 *      lands exactly where the mirror image of the original box would — only
 *      the glyphs are kept readable. Applied by every renderer that draws a
 *      placed symbol (canvas, SVG/PNG/PDF export); DXF does the same with its
 *      own entity fields.
 *
 *   2. Paint that only works on screen. A document-defined symbol is authored
 *      by a model told to "use stroke=black", and a `<g stroke="black"
 *      fill="none">` wrapper around the whole drawing is the natural way to
 *      write that — which makes the text inside it hollow outlines. At screen
 *      zoom that is merely odd; printed at label size the outline swallows the
 *      glyph. A missing `font-size` is the same trap: the canvas inherits the
 *      host page's size, a standalone export the SVG default, DXF its own.
 *      `normalizeSymbolTextPaint` gives every custom-symbol `<text>` a solid
 *      fill, no stroke, and an explicit family/size, so every surface draws
 *      the same readable text. Built-in symbols already carry all of this
 *      and are never rewritten.
 *
 * Both are string rewrites over the tag stream, not DOM work: `buildExportSvg`
 * is pure string assembly and stays usable without a DOM. The fragments are
 * either build-time library content or `sanitizeSymbolSvg` output (serialised
 * by a DOM, so attributes are well-formed and double-quoted). Results are
 * memoised — the canvas re-renders a symbol many times per drag.
 */

/** The family the shipped library writes on its own text. */
export const SYMBOL_TEXT_FONT_FAMILY = 'Liberation Sans, Arial, sans-serif';
/**
 * Used when a custom symbol names no size. 16 is what an unsized SVG `<text>`
 * already rendered at in a standalone export, so pinning it changes nothing
 * that looked right — it only stops the canvas and DXF from disagreeing.
 */
export const SYMBOL_TEXT_DEFAULT_FONT_SIZE = 16;

const TAG_RE = /<(\/?)([a-zA-Z][\w:.-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/g;

function getAttr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
  return m ? (m[1] ?? m[2]) : undefined;
}

function setAttr(attrs: string, name: string, value: string): string {
  const re = new RegExp(`(^|\\s)${name}\\s*=\\s*(?:"[^"]*"|'[^']*')`);
  if (re.test(attrs)) return attrs.replace(re, `$1${name}="${value}"`);
  return `${attrs} ${name}="${value}"`;
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function firstNumber(v: string | undefined): number {
  const n = parseFloat((v ?? '').trim().split(/[\s,]+/)[0] ?? '');
  return Number.isFinite(n) ? n : 0;
}

const SWAP: Record<string, string> = { start: 'end', end: 'start', middle: 'middle' };

function memo(fn: (svg: string) => string): (svg: string) => string {
  const cache = new Map<string, string>();
  return (svg) => {
    const hit = cache.get(svg);
    if (hit !== undefined) return hit;
    const out = fn(svg);
    if (cache.size > 500) cache.clear();
    cache.set(svg, out);
    return out;
  };
}

/** Inheritable text properties, tracked down the `<g>` nesting. */
interface Inherited {
  anchor?: string;
  fill?: string;
  fontSize?: string;
  fontFamily?: string;
}

function inherit(parent: Inherited, attrs: string): Inherited {
  return {
    anchor: getAttr(attrs, 'text-anchor') ?? parent.anchor,
    fill: getAttr(attrs, 'fill') ?? parent.fill,
    fontSize: getAttr(attrs, 'font-size') ?? parent.fontSize,
    fontFamily: getAttr(attrs, 'font-family') ?? parent.fontFamily,
  };
}

const mirrorText = memo((svg: string): string => {
  const stack: Inherited[] = [{}];
  // Anchor x of the enclosing `<text>`, in its own coordinates.
  let textX: number | null = null;
  return svg.replace(TAG_RE, (whole, close: string, rawTag: string, attrs: string, self: string) => {
    const tag = rawTag.toLowerCase();
    const top = stack[stack.length - 1];
    if (close) {
      if (tag === 'g' || tag === 'text' || tag === 'tspan') {
        if (stack.length > 1) stack.pop();
      }
      if (tag === 'text') textX = null;
      return whole;
    }
    if (tag === 'g') {
      if (!self) stack.push(inherit(top, attrs));
      return whole;
    }
    if (tag === 'text') {
      const x = firstNumber(getAttr(attrs, 'x'));
      const anchor = SWAP[getAttr(attrs, 'text-anchor') ?? top.anchor ?? 'start'] ?? 'end';
      // Reflect about the vertical line through the anchor, in the text's
      // own frame (so an authored `transform` still applies on top). The
      // anchor is a fixed point of the reflection, so it stays where the
      // mirrored symbol put it; two reflections cancel, so the glyphs read.
      const own = getAttr(attrs, 'transform');
      const flip = `translate(${round(2 * x)} 0) scale(-1 1)`;
      let next = setAttr(attrs, 'text-anchor', anchor);
      next = setAttr(next, 'transform', own ? `${own} ${flip}` : flip);
      if (!self) {
        stack.push({ ...inherit(top, attrs), anchor });
        textX = x;
      }
      return `<${rawTag}${next}${self ? '/' : ''}>`;
    }
    if (tag === 'tspan') {
      let next = attrs;
      const tx = getAttr(attrs, 'x');
      // A tspan's own x is a point in the reflected frame: map it through
      // the reflection so it lands back where the original line started.
      if (tx !== undefined && textX !== null) {
        const ax = textX;
        const mapped = tx
          .trim()
          .split(/[\s,]+/)
          .map((v) => {
            const n = parseFloat(v);
            return Number.isFinite(n) ? String(round(2 * ax - n)) : v;
          })
          .join(' ');
        next = setAttr(next, 'x', mapped);
      }
      const ta = getAttr(attrs, 'text-anchor');
      if (ta !== undefined) next = setAttr(next, 'text-anchor', SWAP[ta] ?? ta);
      if (!self) stack.push(inherit(top, next));
      return `<${rawTag}${next}${self ? '/' : ''}>`;
    }
    return whole;
  });
});

/**
 * The symbol fragment as it should be drawn on a placement with this
 * `mirror` flag. Identity (same string) when not mirrored or text-free.
 */
export function uprightSymbolText(svg: string, mirror: boolean | undefined): string {
  if (!mirror || !svg || !/<text\b/i.test(svg)) return svg;
  return mirrorText(svg);
}

const normalizePaint = memo((svg: string): string => {
  const stack: Inherited[] = [{}];
  return svg.replace(TAG_RE, (whole, close: string, rawTag: string, attrs: string, self: string) => {
    const tag = rawTag.toLowerCase();
    const top = stack[stack.length - 1];
    if (close) {
      if ((tag === 'g' || tag === 'text') && stack.length > 1) stack.pop();
      return whole;
    }
    if (tag === 'g') {
      if (!self) stack.push(inherit(top, attrs));
      return whole;
    }
    if (tag === 'text' || tag === 'tspan') {
      const eff = inherit(top, attrs);
      let next = attrs;
      if (tag === 'text') {
        if (!eff.fill || eff.fill === 'none' || eff.fill === 'transparent') {
          next = setAttr(next, 'fill', 'black');
        }
        if (!eff.fontSize) next = setAttr(next, 'font-size', String(SYMBOL_TEXT_DEFAULT_FONT_SIZE));
        if (!eff.fontFamily) next = setAttr(next, 'font-family', SYMBOL_TEXT_FONT_FAMILY);
        next = setAttr(next, 'stroke', 'none');
        if (!self) stack.push(inherit(top, next));
      } else {
        const fill = getAttr(attrs, 'fill');
        if (fill === 'none' || fill === 'transparent') next = setAttr(next, 'fill', 'black');
        if (getAttr(attrs, 'stroke') !== undefined) next = setAttr(next, 'stroke', 'none');
      }
      return `<${rawTag}${next}${self ? '/' : ''}>`;
    }
    return whole;
  });
});

/**
 * Give every `<text>` in a document-defined symbol solid, unstroked,
 * explicitly sized paint. Identity when the fragment has no text.
 */
export function normalizeSymbolTextPaint(svg: string): string {
  if (!svg || !/<text\b/i.test(svg)) return svg;
  return normalizePaint(svg);
}
