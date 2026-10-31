/**
 * The marks a circuit diagram (`diagramType: 'circuit'`) draws on top of the
 * plain geometry — computed once here so the canvas, the SVG/PNG/PDF export
 * and the DXF writer can't disagree about where they go:
 *
 *   - pin designations (A1/A2, 13/14, 1/2…) beside each terminal;
 *   - solder dots at device pins and bus taps where 3+ conductors meet;
 *   - the dash pattern of the yellow stripes on a green-yellow (PE) wire.
 *
 * Every function returns nothing for a single-line document, which is what
 * keeps single-line drawings rendering and exporting exactly as before.
 */

import type { InternalModel } from '../compiler/internal-model';
import { pinLabelOf } from '../model/diagram-type';
import type { Orientation, TerminalRef } from '../model';

type Pt = [number, number];

// ---- Pin designations -------------------------------------------------------

/** Pin designations are set smaller than device tags: they are secondary
 *  information that sits right against the drawing. */
export const PIN_LABEL_SCALE = 0.8;
/** Clearance between the pin lead and the text beside it. 4, not 2: the
 *  switching marks at a lead's end (breaker ×, disconnector ○, contactor
 *  hook) reach ~3 units beside it, and 2 put the digits on top of them. */
const PIN_SIDE_GAP = 4;
/** How far inside the terminal point the text starts, so it sits beside the
 *  symbol's own lead and never on the wire that leaves the terminal. */
const PIN_END_GAP = 2.5;
/** Cap height as a share of the font size — designations are digits and
 *  capitals, so this is where the top of the glyphs is. */
const CAP_HEIGHT = 0.72;

export function pinLabelFontSize(labelFontSize: number): number {
  return round(labelFontSize * PIN_LABEL_SCALE);
}

export interface PlacedPinLabel {
  ref: TerminalRef;
  text: string;
  /** Baseline anchor in world coordinates. */
  x: number;
  y: number;
  anchor: 'start' | 'end';
}

/**
 * Where one designation goes, from the terminal's WORLD point and exit
 * direction — so the text is upright whatever the element's rotate / mirror.
 *
 * The text always sits on the inner side of the terminal point (between it
 * and the symbol body), where only the symbol's own lead runs: the wire
 * leaves in the exit direction, so the text can never land on it. Vertical
 * leads take the text on their left — IEC drawings put contact and coil
 * numbers there, and the device tag conventionally sits on the right.
 * Horizontal leads take it above.
 */
export function placePinLabel(
  world: Pt,
  orientation: Orientation,
  fontSize: number,
): { x: number; y: number; anchor: 'start' | 'end' } {
  const [px, py] = world;
  switch (orientation) {
    case 'n':
      return { x: round(px - PIN_SIDE_GAP), y: round(py + PIN_END_GAP + CAP_HEIGHT * fontSize), anchor: 'end' };
    case 's':
      return { x: round(px - PIN_SIDE_GAP), y: round(py - PIN_END_GAP), anchor: 'end' };
    case 'e':
      return { x: round(px - PIN_END_GAP), y: round(py - PIN_SIDE_GAP), anchor: 'end' };
    case 'w':
      return { x: round(px + PIN_END_GAP), y: round(py - PIN_SIDE_GAP), anchor: 'start' };
  }
}

/**
 * Every pin designation of a circuit diagram, placed. Empty for single-line
 * documents. `skip` lets the canvas leave out elements a live viewer hides.
 */
export function placePinLabels(
  model: InternalModel,
  labelFontSize: number,
  skip?: (elementId: string) => boolean,
): PlacedPinLabel[] {
  if (model.diagramType !== 'circuit') return [];
  const fs = pinLabelFontSize(labelFontSize);
  const out: PlacedPinLabel[] = [];
  for (const re of model.elements.values()) {
    const lib = re.libraryDef;
    if (!lib || !model.layout.has(re.element.id)) continue;
    if (skip?.(re.element.id)) continue;
    for (const lt of lib.terminals) {
      const text = pinLabelOf(re.element, lib, lt.id)?.trim();
      if (!text) continue;
      const ref = `${re.element.id}.${lt.id}` as TerminalRef;
      const term = model.terminals.get(ref);
      if (!term) continue;
      out.push({ ref, text, ...placePinLabel(term.world, term.orientation, fs) });
    }
  }
  return out;
}

// ---- Solder dots --------------------------------------------------------------

/**
 * Solder dots a circuit diagram needs IN ADDITION to junction dots (which
 * every diagram already draws where 3+ wires meet at a junction).
 *
 * A dot belongs wherever 3+ conductors meet. Counted at each wire end:
 *   - every wire ending at the point: 1;
 *   - a device terminal at the point: 1 (its lead) — so two wires on one pin
 *     (a T at the pin) get a dot, one wire does not;
 *   - a bus passing through the point: 2, or 1 at the bus's very end — so a
 *     tap off a rail gets a dot and a wire meeting the rail's end (a corner)
 *     does not.
 * Junction points are left to the junction layer, so nothing is dotted twice.
 * Empty for single-line documents.
 */
export function circuitSolderDots(model: InternalModel): Pt[] {
  if (model.diagramType !== 'circuit') return [];
  const key = (p: readonly number[]) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;

  const wireEnds = new Map<string, { at: Pt; n: number }>();
  for (const r of model.wireRenders.values()) {
    if (r.path.length < 2) continue;
    for (const p of [r.path[0], r.path[r.path.length - 1]]) {
      const k = key(p);
      const cur = wireEnds.get(k);
      if (cur) cur.n++;
      else wireEnds.set(k, { at: [p[0], p[1]], n: 1 });
    }
  }
  if (wireEnds.size === 0) return [];

  const junctionAt = new Set<string>();
  for (const rj of model.junctions.values()) junctionAt.add(key(rj.world));
  const terminalsAt = new Map<string, number>();
  for (const t of model.terminals.values()) {
    const k = key(t.world);
    terminalsAt.set(k, (terminalsAt.get(k) ?? 0) + 1);
  }

  const out: Pt[] = [];
  for (const [k, { at, n }] of wireEnds) {
    if (junctionAt.has(k)) continue;
    let count = n + (terminalsAt.get(k) ?? 0);
    for (const { geometry } of model.buses.values()) {
      count += busConductorsAt(geometry, at);
      if (count >= 3) break;
    }
    if (count >= 3) out.push(at);
  }
  return out;
}

/** 2 where the point is on a bus's run, 1 at either end of it, else 0. */
function busConductorsAt(
  g: { at: [number, number]; span: number; axis: 'x' | 'y' },
  p: Pt,
): number {
  const EPS = 0.01;
  const half = g.span / 2;
  const along = g.axis === 'x' ? p[0] - g.at[0] : p[1] - g.at[1];
  const across = g.axis === 'x' ? p[1] - g.at[1] : p[0] - g.at[0];
  if (Math.abs(across) > EPS || Math.abs(along) > half + EPS) return 0;
  return Math.abs(Math.abs(along) - half) <= EPS ? 1 : 2;
}

// ---- PE stripes ---------------------------------------------------------------

/** Dash / gap length of the yellow stripes on a green-yellow wire. The
 *  canvas, the SVG export and the DXF dashes all use this one pattern. */
export const PE_STRIPE_DASH = 4;
export const PE_STRIPE_DASHARRAY = `${PE_STRIPE_DASH} ${PE_STRIPE_DASH}`;

/**
 * The stripes of a green-yellow wire as explicit segments — for writers with
 * no dash pattern of their own (DXF R12 without a linetype table). Same phase
 * as SVG's `stroke-dasharray`: on from the first point, continuous around
 * corners.
 */
export function stripeSegments(path: readonly (readonly [number, number])[], dash = PE_STRIPE_DASH): [Pt, Pt][] {
  const out: [Pt, Pt][] = [];
  let pos = 0; // distance along the whole polyline
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len === 0) continue;
    const at = (d: number): Pt => [
      round(a[0] + ((b[0] - a[0]) * d) / len),
      round(a[1] + ((b[1] - a[1]) * d) / len),
    ];
    let d = 0;
    while (d < len - 1e-9) {
      const phase = (pos + d) % (2 * dash);
      const on = phase < dash;
      const step = Math.min(len - d, (on ? dash : 2 * dash) - phase);
      if (on && step > 1e-9) out.push([at(d), at(d + step)]);
      d += step;
    }
    pos += len;
  }
  return out;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
