/**
 * The named ink palette: one place that decides what every `DiagramColor`
 * looks like on a light canvas, on a dark canvas, and in a DXF file.
 *
 * Why names instead of free hex (the Visio answer): the canvas has a dark
 * theme. A literal colour cannot follow it, so "black" would be invisible the
 * moment a user switched, and every drawing would have to be re-coloured by
 * hand. Names carry intent — "this feeder is red" — and each renderer resolves
 * intent to whatever reads correctly in its own medium.
 *
 * Palette size is deliberately small. Six choices keep a drawing coherent
 * (a diagram with forty hand-picked hexes reads as noise), and they map
 * one-to-one onto ACI indices, which is what CAD tools actually colour by.
 */

import type { DiagramColor } from '../model';

export interface ColorSpec {
  /** Canvas + export ink on a light background. */
  light: string;
  /** Canvas ink on a dark background. */
  dark: string;
  /**
   * AutoCAD Color Index. 7 is the "use the viewport's own foreground" entry,
   * which is why `default` maps to it — a default-coloured drawing keeps
   * behaving the way it always has when opened in CAD.
   */
  aci: number;
}

export const NAMED_COLORS: Record<DiagramColor, ColorSpec> = {
  // `light: 'black'` is exact, not approximate: every export path emitted the
  // literal string `black` before colours existed, and a diagram with no
  // colour fields has to keep producing byte-identical SVG.
  default: { light: 'black', dark: '#E5E7EB', aci: 7 },
  red: { light: '#C0392B', dark: '#FF6B6B', aci: 1 },
  blue: { light: '#1F6FEB', dark: '#58A6FF', aci: 5 },
  green: { light: '#197D3F', dark: '#4ADE80', aci: 3 },
  amber: { light: '#B45309', dark: '#FBBF24', aci: 30 },
  gray: { light: '#6B7280', dark: '#9CA3AF', aci: 8 },
};

/** Palette order for pickers — `default` first, then warm → cool → neutral. */
export const COLOR_ORDER: DiagramColor[] = [
  'default',
  'red',
  'amber',
  'green',
  'blue',
  'gray',
];

function isNamed(c: string | undefined): c is DiagramColor {
  return c !== undefined && c in NAMED_COLORS;
}

/**
 * CSS class that paints an object in `c`, or `undefined` for the default.
 *
 * Returning `undefined` rather than a `ole-ink-default` class matters: the
 * canvas already inherits theme ink through `currentColor`, so an uncoloured
 * object keeps exactly the DOM it had before this feature — no extra class,
 * no extra specificity fight with the selection recolor.
 */
export function inkClass(c: DiagramColor | undefined): string | undefined {
  return isNamed(c) && c !== 'default' ? `ole-ink-${c}` : undefined;
}

/**
 * Ink for the SVG/PNG exporters. Always the LIGHT value: an export is a
 * document headed for paper, a CAD seat or an email, none of which inherit the
 * editor's theme. `default` resolves to the literal `black` the exporters
 * emitted before colours existed.
 */
export function exportInk(c: DiagramColor | undefined): string {
  return isNamed(c) ? NAMED_COLORS[c].light : 'black';
}

/**
 * ACI index for the DXF writer, or `undefined` when the entity should inherit
 * its layer colour. Group code 62 is omitted entirely in that case, so an
 * uncoloured diagram writes the same bytes it always did.
 */
export function dxfColor(c: DiagramColor | undefined): number | undefined {
  return isNamed(c) && c !== 'default' ? NAMED_COLORS[c].aci : undefined;
}
