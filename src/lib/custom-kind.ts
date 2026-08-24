/**
 * Validation for symbols a document defines itself (`DiagramFile.customKinds`).
 *
 * Two gates, and both exist because the author is not a person reviewing their
 * own work — it is a language model producing markup that will be persisted to
 * storage and re-rendered to third parties through public share links.
 *
 *   1. `sanitizeSymbolSvg` — an allowlist, not a blocklist. The existing
 *      `dangerouslySetInnerHTML` sites in the canvas are safe precisely because
 *      their comment is true ("the library JSON is build-time content"); a
 *      generated symbol is not, so it has to be reduced to markup that cannot
 *      execute before it reaches the DOM.
 *
 *   2. `validateCustomKind` — structural checks that stop a symbol which is
 *      *safe* but *wrong* in a way every future use of it would inherit.
 *
 * Both allowlists below are MEASURED, not designed: they are exactly the
 * vocabulary the 92 shipped symbols use. That matters for the argument as much
 * as for the coverage — anything outside this set is by definition not needed
 * to draw an electrical symbol, so rejecting it costs nothing real. It also
 * happens to be the same set `export-dxf.ts` can translate, which is why a
 * custom kind exports to CAD without a line of new export code.
 */

import type { LibraryEntry, LibraryTerminal } from '../model';

/** Elements used across the shipped library. `g` is a grouping container. */
export const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  'g',
  'line',
  'rect',
  'circle',
  'ellipse',
  'polyline',
  'polygon',
  'path',
  'text',
  'tspan',
]);

/**
 * Attributes used across the shipped library, plus `tspan`'s positioning.
 * Deliberately excludes every URL-bearing and scripting attribute: no `href`,
 * no `xlink:href`, no `on*`, no `style` (which can smuggle `url()`).
 */
export const ALLOWED_ATTRS: ReadonlySet<string> = new Set([
  'fill',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'fill-opacity',
  'stroke-opacity',
  'opacity',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'points',
  'd',
  'transform',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
  'dominant-baseline',
]);

export interface SanitizeResult {
  /** The cleaned fragment. Empty when nothing survived. */
  svg: string;
  /** What was dropped, as `element:<name>` / `attr:<name>`, deduped. */
  removed: string[];
}

/**
 * Reduce a symbol fragment to the allowlisted subset.
 *
 * Parsed as a real document rather than filtered with regexes: markup is not a
 * regular language, and the whole point of the exercise is to be right about
 * markup an adversary controls.
 */
export function sanitizeSymbolSvg(source: string): SanitizeResult {
  const removed = new Set<string>();
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${source}</svg>`,
    'image/svg+xml',
  );
  const root = doc.documentElement;
  if (!root || doc.querySelector('parsererror')) {
    return { svg: '', removed: ['parse-error'] };
  }

  const walk = (node: Element) => {
    for (const child of [...node.children]) {
      const tag = child.tagName.toLowerCase();
      if (!ALLOWED_ELEMENTS.has(tag)) {
        removed.add(`element:${tag}`);
        child.remove();
        continue;
      }
      for (const attr of [...child.attributes]) {
        // Compare on the local name so a namespace prefix cannot smuggle a
        // banned attribute past the set (`xlink:href` vs `href`).
        const name = (attr.localName ?? attr.name).toLowerCase();
        if (!ALLOWED_ATTRS.has(name)) {
          removed.add(`attr:${attr.name.toLowerCase()}`);
          child.removeAttribute(attr.name);
        }
      }
      walk(child);
    }
  };
  walk(root);

  return { svg: root.innerHTML.trim(), removed: [...removed].sort() };
}

export interface KindProblem {
  field: string;
  message: string;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * Structural checks on a proposed symbol.
 *
 * The axis check is the one that earns its place. A two-terminal series device
 * whose pins do not share a coordinate is jogged BY CONSTRUCTION: every wire
 * into it, in every drawing that ever uses it, leaves at a right angle no
 * matter how well the user places things. The library already carries a few
 * such kinds (`ct` has both pins at x = -30) and they are the documented cause
 * of the W101 warning existing at all — in the 2026-08-15→21 audit W101 was
 * still present in 44 of 98 sessions at hand-off. Letting a model mint more of
 * them would make that permanent rather than incidental.
 *
 * What is deliberately NOT checked: how far a terminal sits inside the
 * viewBox. Measuring the shipped library first killed that idea — 156 of 165
 * terminals sit exactly 2 units in, but `autotransformer`'s bottom pin is 12
 * units in because the symbol is two stacked coils, and `luminaire`,
 * `converter-bidir` and `busbar` all have legitimate centre taps. A
 * boundary rule would have rejected real symbols.
 */
export function validateCustomKind(entry: LibraryEntry): KindProblem[] {
  const problems: KindProblem[] = [];
  const add = (field: string, message: string) => problems.push({ field, message });

  if (!entry.id?.startsWith('custom:')) {
    add('id', 'a document-defined kind must have a `custom:` id so it can never shadow a built-in');
  }
  if (!entry.name?.trim()) add('name', 'name is required — it is what the user sees in the palette');
  if (!entry.category?.trim()) add('category', 'category is required for palette grouping');

  const vb = (entry.viewBox ?? '').trim().split(/[\s,]+/).map(Number);
  const boxOk = vb.length === 4 && vb.every((n) => Number.isFinite(n)) && vb[2] > 0 && vb[3] > 0;
  if (!boxOk) {
    add('viewBox', 'viewBox must be four finite numbers "minX minY width height" with positive extent');
  }

  if (!entry.svg?.trim()) add('svg', 'svg is empty — a symbol with no geometry is invisible on the canvas');

  const terms = entry.terminals ?? [];
  if (!terms.length) {
    add('terminals', 'declare at least one terminal, or nothing can ever be wired to this symbol');
  }
  const seen = new Set<string>();
  for (const t of terms) {
    if (!t?.id?.trim()) { add('terminals', 'every terminal needs an id'); continue; }
    if (seen.has(t.id)) add('terminals', `duplicate terminal id '${t.id}'`);
    seen.add(t.id);
    if (num(t.x) === null || num(t.y) === null) {
      add('terminals', `terminal '${t.id}' needs finite x and y`);
      continue;
    }
    if (boxOk) {
      const [x0, y0, w, h] = vb;
      const inside = t.x >= x0 && t.x <= x0 + w && t.y >= y0 && t.y <= y0 + h;
      if (!inside) {
        add(
          'terminals',
          `terminal '${t.id}' at (${t.x}, ${t.y}) is outside the viewBox — ` +
            'a pin floating off the symbol body leaves a visible gap at every connection',
        );
      }
    }
  }

  if (terms.length === 2) {
    const [a, b] = terms as [LibraryTerminal, LibraryTerminal];
    if (num(a.x) !== null && num(b.x) !== null && a.x !== b.x && a.y !== b.y) {
      add(
        'terminals',
        `the two terminals share neither an x (${a.x} vs ${b.x}) nor a y (${a.y} vs ${b.y}). ` +
          'A series device whose pins are offset on both axes renders every wire into it with a ' +
          'right-angle jog, in every drawing, permanently — put both pins on the run axis.',
      );
    }
  }

  return problems;
}
