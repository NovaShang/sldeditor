/**
 * Mint a fresh `ElementId` based on the kind. Prefixes match the conventions
 * power engineers use on real schematics (QF for breakers, QS for
 * disconnectors, etc.); unknown kinds fall back to the kind string itself.
 */

import type { DiagramFile, ElementId } from '@/model';

const PREFIX: Record<string, string> = {
  busbar: 'B',
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

export function newElementId(diagram: DiagramFile, kind: string): ElementId {
  const prefix = PREFIX[kind] ?? kind;
  const used = new Set(diagram.elements.map((e) => e.id));
  let n = 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}
