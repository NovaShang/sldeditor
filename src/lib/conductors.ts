/**
 * Conductor presets for circuit diagrams — IEC 60445 phase colours paired
 * with the conductor's designation. One preset sets BOTH `color` and `label`
 * of a wire, because on a circuit diagram the two say the same thing: a brown
 * conductor marked "L1" is one fact, and setting them separately is how a
 * drawing ends up with a blue "L1".
 *
 * L2 is black — the drawing's default ink — so its preset clears `color`
 * rather than storing `default` (the stored-absence rule every colour
 * follows; see `setSelectionColor`).
 */

import type { Bus, BusId, DiagramColor, DiagramFile, Wire } from '../model';

export interface ConductorPreset {
  /** Designation written as the wire label. Not localised: L1/L2/L3/N/PE
   *  are the IEC designations in every language. */
  label: 'L1' | 'L2' | 'L3' | 'N' | 'PE';
  color: DiagramColor;
}

export const CONDUCTOR_PRESETS: readonly ConductorPreset[] = [
  { label: 'L1', color: 'brown' },
  { label: 'L2', color: 'default' },
  { label: 'L3', color: 'gray' },
  { label: 'N', color: 'blue' },
  { label: 'PE', color: 'green-yellow' },
];

/**
 * Presets for a supply rail (a `Bus` on a circuit diagram): the five main-
 * circuit conductors plus the control-circuit potentials. The rail's name IS
 * its potential, so a preset sets `name` and `color` together. Control rails
 * stay in the drawing's default ink — only main-circuit conductors carry
 * IEC 60445 colours, as on the shipped templates.
 */
export interface RailPreset {
  label: string;
  color: DiagramColor;
}

export const RAIL_PRESETS: readonly RailPreset[] = [
  ...CONDUCTOR_PRESETS,
  { label: 'L', color: 'default' },
  { label: '+24V', color: 'default' },
  { label: '0V', color: 'default' },
];

/** Whether a rail currently carries exactly this preset. */
export function railHasPreset(bus: Pick<Bus, 'name' | 'color'>, preset: RailPreset): boolean {
  return bus.name?.trim() === preset.label && (bus.color ?? 'default') === preset.color;
}

/** Name and colour one rail from a preset. Returns `d` itself when nothing
 *  would change (no empty undo step). */
export function applyRailPreset(d: DiagramFile, busId: BusId, preset: RailPreset): DiagramFile {
  const bus = (d.buses ?? []).find((b) => b.id === busId);
  if (!bus || railHasPreset(bus, preset)) return d;
  const { color: _c, ...rest } = bus;
  const next: Bus = {
    ...rest,
    name: preset.label,
    ...(preset.color !== 'default' ? { color: preset.color } : {}),
  };
  return { ...d, buses: (d.buses ?? []).map((b) => (b.id === busId ? next : b)) };
}

/** Whether a wire currently carries exactly this preset. */
export function wireHasConductor(wire: Pick<Wire, 'label' | 'color'>, preset: ConductorPreset): boolean {
  return wire.label?.trim() === preset.label && (wire.color ?? 'default') === preset.color;
}

/**
 * Apply a preset to some wires. Returns `d` itself when nothing would change,
 * so a caller dispatching it never records an empty undo step.
 *
 * `labelOn` is for a whole node (one potential, many drawn wires): every wire
 * takes the colour, but only that wire takes the designation — "L1" written
 * on each piece of one conductor is noise — and the other wires lose any
 * conductor designation (L1…PE) they carried, so a brown wire never keeps a
 * stale "L2". Their other labels (wire numbers, hand-written names) stay.
 */
export function applyConductor(
  d: DiagramFile,
  wireIds: Iterable<string>,
  preset: ConductorPreset,
  labelOn?: string,
): DiagramFile {
  const ids = new Set(wireIds);
  let changed = false;
  const wires = (d.wires ?? []).map((w) => {
    if (!ids.has(w.id)) return w;
    const next = paintConductor(w, preset, labelOn === undefined || labelOn === w.id);
    if (next !== w) changed = true;
    return next;
  });
  return changed ? { ...d, wires } : d;
}

const DESIGNATIONS = new Set<string>(CONDUCTOR_PRESETS.map((p) => p.label));

function paintConductor<W extends Pick<Wire, 'label' | 'color'>>(
  w: W,
  preset: ConductorPreset,
  withLabel: boolean,
): W {
  const label = withLabel
    ? preset.label
    : w.label !== undefined && DESIGNATIONS.has(w.label.trim())
      ? undefined
      : w.label;
  const color = preset.color === 'default' ? undefined : preset.color;
  if (w.label === label && w.color === color) return w;
  const { color: _c, label: _l, ...rest } = w;
  return {
    ...rest,
    ...(label !== undefined ? { label } : {}),
    ...(color !== undefined ? { color } : {}),
  } as W;
}

/** Whether a node's wires carry this preset the way `applyConductor` with
 *  `labelOn` leaves them. */
export function nodeHasConductor(
  wires: readonly Pick<Wire, 'id' | 'label' | 'color'>[],
  preset: ConductorPreset,
  labelOn: string | undefined,
): boolean {
  return (
    wires.length > 0 &&
    wires.every((w) =>
      w.id === labelOn
        ? wireHasConductor(w, preset)
        : (w.color ?? 'default') === preset.color &&
          !(w.label !== undefined && DESIGNATIONS.has(w.label.trim())),
    )
  );
}

/** The longest drawn wire among `ids` — where a node's designation goes. Ties
 *  fall to the smaller id so the choice never depends on array order. */
export function longestWire(
  ids: readonly string[],
  renders: ReadonlyMap<string, { path: readonly (readonly [number, number])[] }>,
): string | undefined {
  let best: string | undefined;
  let bestLen = -1;
  for (const id of [...ids].sort()) {
    const path = renders.get(id)?.path ?? [];
    let len = 0;
    for (let i = 1; i < path.length; i++) {
      len += Math.abs(path[i][0] - path[i - 1][0]) + Math.abs(path[i][1] - path[i - 1][1]);
    }
    if (len > bestLen) {
      best = id;
      bestLen = len;
    }
  }
  return best;
}
