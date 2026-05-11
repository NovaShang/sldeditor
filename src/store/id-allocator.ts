/**
 * ID minting for new elements / buses / annotations / wires. Element and bus
 * prefixes follow real-schematic conventions; wires use a deterministic
 * content hash so the same pair of endpoints always maps to the same id.
 */

import type { DiagramFile, ElementId, WireEnd, WireId } from '../model';

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

function usedIds(diagram: DiagramFile): Set<string> {
  return new Set([
    ...diagram.elements.map((e) => e.id),
    ...(diagram.buses ?? []).map((b) => b.id),
  ]);
}

export function newElementId(diagram: DiagramFile, kind: string): ElementId {
  const prefix = PREFIX[kind] ?? kind;
  const used = usedIds(diagram);
  let n = 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

export function newBusId(diagram: DiagramFile): ElementId {
  const used = usedIds(diagram);
  let n = 1;
  while (used.has(`${BUS_PREFIX}${n}`)) n++;
  return `${BUS_PREFIX}${n}`;
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
