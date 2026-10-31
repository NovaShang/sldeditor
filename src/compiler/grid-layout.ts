/**
 * Placement for circuit diagrams: auto-layout is OFF.
 *
 * The single-line auto-layout reasons about buses, feeders and tiers — a
 * circuit diagram's conventions (multi-line main circuit, control circuit
 * between two rails, vertical current paths) contradict it, and a "helpful"
 * arrangement would scramble a drawing whose positions carry meaning. So in a
 * circuit document explicit positions are the drawing, and anything that has
 * none is simply set down on a plain grid BESIDE the existing content (to its
 * right, top-aligned), where the user or the AI can pick it up and place it.
 *
 * Deterministic: document order, fixed cell sizes, 10-unit grid. Unplaced
 * buses come first as horizontal rails stacked one above the other, then
 * devices row by row underneath them.
 */

import type { BusId, ElementId, JunctionId } from '../model';
import type { AutoLayoutInput, AutoLayoutOutput } from './auto-layout';
import type { BusGeometry, ResolvedPlacement } from './internal-model';
import { transformPoint } from './transforms';

const GRID = 10;
/** Gap between existing content and the grid, and between grid cells. */
const GAP = 40;
const ORIGIN: [number, number] = [0, 0];
const BUS_SPAN = 320;
const BUS_PITCH = 60;
const COLS = 6;
/** Cell size never below this, so tiny symbols do not crowd each other. */
const MIN_CELL = 60;

type Box = { minX: number; minY: number; maxX: number; maxY: number };

function viewBoxOf(vb: string | undefined): [number, number, number, number] | null {
  const n = (vb ?? '').trim().split(/\s+/).map(Number);
  return n.length === 4 && n.every((v) => Number.isFinite(v)) ? (n as [number, number, number, number]) : null;
}

const snap = (v: number) => Math.round(v / GRID) * GRID;
const snapUp = (v: number) => Math.ceil(v / GRID) * GRID;

export function gridLayout(input: AutoLayoutInput): AutoLayoutOutput {
  const { elements, buses, junctions, library, userLayout, userBusLayout } = input;
  const devices = new Map<ElementId, ResolvedPlacement>(userLayout);
  const busOut = new Map<BusId, BusGeometry>(userBusLayout);

  // ---- extent of what is already placed ---------------------------------
  let box: Box | null = null;
  const grow = (x: number, y: number) => {
    if (!box) box = { minX: x, minY: y, maxX: x, maxY: y };
    else {
      box.minX = Math.min(box.minX, x);
      box.minY = Math.min(box.minY, y);
      box.maxX = Math.max(box.maxX, x);
      box.maxY = Math.max(box.maxY, y);
    }
  };
  for (const el of elements) {
    const place = userLayout.get(el.id);
    if (!place) continue;
    const vb = viewBoxOf(library.get(el.kind)?.viewBox);
    if (!vb) {
      grow(place.at[0], place.at[1]);
      continue;
    }
    const [x, y, w, h] = vb;
    for (const c of [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] as [number, number][]) {
      const p = transformPoint(c, place);
      grow(p[0], p[1]);
    }
  }
  for (const [, g] of userBusLayout) {
    const half = g.span / 2;
    if (g.axis === 'x') {
      grow(g.at[0] - half, g.at[1]);
      grow(g.at[0] + half, g.at[1]);
    } else {
      grow(g.at[0], g.at[1] - half);
      grow(g.at[0], g.at[1] + half);
    }
  }
  for (const j of junctions) if (j.layout?.at) grow(j.layout.at[0], j.layout.at[1]);

  const placed = box as Box | null;
  const x0 = placed ? snapUp(placed.maxX + GAP) : ORIGIN[0];
  let y = placed ? snap(placed.minY) : ORIGIN[1];

  // ---- rails first ------------------------------------------------------
  for (const bus of buses) {
    if (busOut.has(bus.id)) continue;
    busOut.set(bus.id, { at: [x0 + BUS_SPAN / 2, y], span: BUS_SPAN, rot: 0, axis: 'x' });
    y += BUS_PITCH;
  }

  // ---- then devices, row by row -----------------------------------------
  const todo = elements.filter((el) => !devices.has(el.id));
  if (todo.length === 0) return { devices, buses: busOut, junctions: new Map<JunctionId, [number, number]>() };
  const boxes = todo.map((el) => viewBoxOf(library.get(el.kind)?.viewBox) ?? [0, 0, 0, 0]);
  const cellW = snapUp(Math.max(MIN_CELL, ...boxes.map((b) => b[2])) + GAP);
  const cellH = snapUp(Math.max(MIN_CELL, ...boxes.map((b) => b[3])) + GAP);
  todo.forEach((el, i) => {
    const [vx, vy] = boxes[i];
    const cx = x0 + (i % COLS) * cellW;
    const cy = y + Math.floor(i / COLS) * cellH;
    // The symbol's top-left corner on (or just inside) the cell corner; the
    // origin stays on the grid so its pins do too.
    devices.set(el.id, { at: [snapUp(cx - vx), snapUp(cy - vy)], rot: 0, mirror: false });
  });

  return { devices, buses: busOut, junctions: new Map<JunctionId, [number, number]>() };
}
