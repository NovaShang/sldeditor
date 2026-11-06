/**
 * ID minting for new elements / buses / annotations / wires. Element and bus
 * prefixes follow real-schematic conventions; wires use a deterministic
 * content hash so the same pair of endpoints always maps to the same id.
 */

import type { DiagramFile, ElementId, WireEnd, WireId } from '../model';
import { isCircuitDiagram } from '../model/diagram-type';

const PREFIX: Record<string, string> = {
  earth: 'GND',
  breaker: 'QF',
  disconnector: 'QS',
  'earthing-switch': 'QE',
  'load-switch': 'QL',
  fuse: 'FU',
  'transformer-2w': 'T',
  'transformer-3w': 'T',
  autotransformer: 'AT',
  ct: 'CT',
  pt: 'PT',
  generator: 'G',
  'sync-motor': 'M',
  'async-motor': 'M',
  'grid-source': 'L',
  load: 'L',
  battery: 'BAT',
  'shunt-reactor': 'LR',
  'series-reactor': 'LR',
  'shunt-capacitor': 'C',
  arrester: 'FBL',
  'grounding-transformer': 'TG',
  ngr: 'NGR',
  'arc-suppression-coil': 'ASC',
  pv: 'PV',
  'wind-turbine': 'WT',
  rectifier: 'RT',
  inverter: 'INV',
  'converter-bidir': 'PCS',
};

const BUS_PREFIX = 'B';
const JUNCTION_PREFIX = 'J';

function usedIds(diagram: DiagramFile): Set<string> {
  return new Set([
    ...diagram.elements.map((e) => e.id),
    ...(diagram.buses ?? []).map((b) => b.id),
    ...(diagram.junctions ?? []).map((j) => j.id),
  ]);
}

export function newElementId(diagram: DiagramFile, kind: string): ElementId {
  const prefix = PREFIX[kind] ?? kind;
  const used = usedIds(diagram);
  let n = 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/**
 * Letter code (IEC 81346-2, in the form circuit diagrams are drawn with) a
 * newly placed device is tagged by on a circuit diagram. Kinds without one
 * (contacts — their tag is their operator's, which placing one cannot know —
 * earth, continuation arrows, single-line blocks) keep the single-line naming.
 */
const CIRCUIT_TAG_CODE: Record<string, string> = {
  // Switching power: breakers, switch-disconnectors, motor-protection breaker.
  breaker: 'Q',
  'breaker-3p': 'Q',
  'motor-breaker-3p': 'Q',
  'switch-disconnector-3p': 'Q',
  disconnector: 'Q',
  'dc-disconnector': 'Q',
  'load-switch': 'Q',
  'fuse-switch-disconnector': 'Q',
  'earthing-switch': 'Q',
  'transfer-switch': 'Q',
  'motor-starter': 'Q',
  // Protection: fuses, MCB, RCD, overload relays, protective relays.
  fuse: 'F',
  'fuse-3p': 'F',
  'mcb-1pn': 'F',
  rcd: 'F',
  'rcd-4p': 'F',
  'gfci-breaker': 'F',
  'overload-relay-3p': 'F',
  'thermal-overload': 'F',
  'protective-relay': 'F',
  'phase-failure-relay': 'F',
  arrester: 'F',
  contactor: 'KM',
  'contactor-3p': 'KM',
  'relay-coil': 'K',
  plc: 'K',
  'time-relay': 'KT',
  // Manual control.
  'push-button': 'S',
  'push-button-break': 'S',
  'emergency-stop': 'S',
  'selector-switch': 'S',
  // Position / proximity switches and sensors detect rather than get pressed.
  'limit-switch': 'B',
  'limit-switch-break': 'B',
  'proximity-switch': 'B',
  thermocouple: 'B',
  'indicator-light': 'H',
  bell: 'H',
  buzzer: 'H',
  siren: 'H',
  'async-motor': 'M',
  'sync-motor': 'M',
  'dc-motor': 'M',
  'motor-3ph': 'M',
  'motor-3ph-6t': 'M',
  terminal: 'X',
  'terminal-block': 'X',
  'socket-outlet': 'X',
  'supply-3ph': 'X',
  'transformer-2w': 'T',
  'transformer-3w': 'T',
  autotransformer: 'T',
  ct: 'T',
  pt: 'T',
  'voltage-regulator': 'T',
  rectifier: 'T',
  inverter: 'T',
  'dc-dc-converter': 'T',
  'converter-bidir': 'T',
  mppt: 'T',
  vfd: 'T',
  'soft-starter': 'T',
  'power-supply': 'G',
  generator: 'G',
  genset: 'G',
  battery: 'G',
  ups: 'G',
  pv: 'G',
  'wind-turbine': 'G',
  ammeter: 'P',
  voltmeter: 'P',
  wattmeter: 'P',
  varmeter: 'P',
  'energy-meter': 'P',
  'frequency-meter': 'P',
  'power-factor-meter': 'P',
  synchronoscope: 'P',
  heater: 'E',
  luminaire: 'E',
  resistor: 'R',
  capacitor: 'C',
  'shunt-capacitor': 'C',
  inductor: 'L',
  'shunt-reactor': 'L',
  'series-reactor': 'L',
  diode: 'V',
  'zener-diode': 'V',
  thyristor: 'V',
  triac: 'V',
  igbt: 'V',
};

/** The letter code `kind` is tagged by on a circuit diagram, if it has one. */
export function circuitTagCode(kind: string): string | undefined {
  return CIRCUIT_TAG_CODE[kind];
}

/**
 * Id and name for a device placed on a circuit diagram: the next free tag of
 * its letter code, numbered per code (-KM1, -KM2…), e.g. `{ id: 'KM2', name:
 * '-KM2' }`. A tag counts as taken when any element's name starts with it
 * (contacts carry their operator's tag, terminals "-X1:3") or an unnamed
 * element's id is it. `null` for kinds without a code.
 */
export function newCircuitTag(
  diagram: DiagramFile,
  kind: string,
): { id: ElementId; name: string } | null {
  const code = CIRCUIT_TAG_CODE[kind];
  if (!code) return null;
  const taken = new Set<number>();
  const byName = new RegExp(`^-?${code}(\\d+)`);
  const byId = new RegExp(`^${code}(\\d+)$`);
  for (const el of diagram.elements) {
    const m = el.name !== undefined ? byName.exec(el.name.trim()) : byId.exec(el.id);
    if (m) taken.add(Number(m[1]));
  }
  let n = 1;
  while (taken.has(n)) n++;
  const used = usedIds(diagram);
  let id = `${code}${n}`;
  for (let k = 2; used.has(id); k++) id = `${code}${n}_${k}`;
  return { id, name: `-${code}${n}` };
}

/**
 * Identity of an element the user is placing: the circuit-diagram tag when
 * the drawing is one and the kind has a letter code, else the single-line id
 * with no name. Every placement path (free drop, bus tap, drag from a pin)
 * goes through here so they agree.
 */
export function newPlacedElement(
  diagram: DiagramFile,
  kind: string,
): { id: ElementId; name?: string } {
  return (isCircuitDiagram(diagram) && newCircuitTag(diagram, kind)) || { id: newElementId(diagram, kind) };
}

export function newBusId(diagram: DiagramFile): ElementId {
  const used = usedIds(diagram);
  let n = 1;
  while (used.has(`${BUS_PREFIX}${n}`)) n++;
  return `${BUS_PREFIX}${n}`;
}

export function newJunctionId(diagram: DiagramFile): ElementId {
  const used = usedIds(diagram);
  let n = 1;
  while (used.has(`${JUNCTION_PREFIX}${n}`)) n++;
  return `${JUNCTION_PREFIX}${n}`;
}

export function newAnnotationId(diagram: DiagramFile): string {
  const used = new Set((diagram.annotations ?? []).map((a) => a.id));
  let n = 1;
  while (used.has(`a${n}`)) n++;
  return `a${n}`;
}

/**
 * Content-hashed wire id. Two wires with the same pair of endpoints collide
 * intentionally — duplicate `addWire` is a no-op, and migration / save
 * round-trips produce stable diffs.
 */
export function wireIdFromEnds(a: WireEnd, b: WireEnd): WireId {
  const sorted = [a, b].sort();
  const text = `${sorted[0]}|${sorted[1]}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `w_${(h >>> 0).toString(36)}`;
}
