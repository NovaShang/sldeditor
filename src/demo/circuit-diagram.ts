import type { DiagramFile } from '../model';

/**
 * Direct-on-line starter, IEC circuit diagram — the demo page's `#circuit`
 * route. Main circuit on the left drawn multi-line with conductor presets
 * (L1 brown, L2 black, L3 grey, PE green-yellow); control circuit on the
 * right between the L and N rails: overload 95-96, stop, start with seal-in,
 * coil, and a run lamp on a second auxiliary contact (23-24).
 */
export const CIRCUIT_DIAGRAM: DiagramFile = {
  version: '1',
  meta: { title: 'DOL starter', diagramType: 'circuit' },
  elements: [
    { id: 'X0', kind: 'supply-3ph', name: '-X0' },
    { id: 'Q1', kind: 'breaker-3p', name: '-Q1' },
    { id: 'KM1', kind: 'contactor-3p', name: '-KM1' },
    { id: 'F2', kind: 'overload-relay-3p', name: '-F2' },
    { id: 'M1', kind: 'motor-3ph', name: '-M1' },
    { id: 'F2a', kind: 'overload-contact-break', name: '-F2' },
    { id: 'SB1', kind: 'push-button-break', name: '-SB1' },
    { id: 'SB2', kind: 'push-button', name: '-SB2' },
    { id: 'KM1c', kind: 'relay-coil', name: '-KM1' },
    { id: 'KM1a', kind: 'make-contact', name: '-KM1' },
    { id: 'KM1b', kind: 'make-contact', name: '-KM1', pinLabels: { t1: '23', t2: '24' } },
    { id: 'H1', kind: 'indicator-light', name: '-H1' },
  ],
  buses: [
    { id: 'L', name: 'L', layout: { at: [260, 40], span: 200 } },
    { id: 'N', name: 'N', layout: { at: [260, 360], span: 200 } },
  ],
  wires: [
    { id: 'm1', ends: ['X0.t_l1', 'Q1.t1'], color: 'brown', label: 'L1' },
    { id: 'm2', ends: ['X0.t_l2', 'Q1.t3'], label: 'L2' },
    { id: 'm3', ends: ['X0.t_l3', 'Q1.t5'], color: 'gray', label: 'L3' },
    { id: 'm4', ends: ['Q1.t2', 'KM1.t1'] },
    { id: 'm5', ends: ['Q1.t4', 'KM1.t3'] },
    { id: 'm6', ends: ['Q1.t6', 'KM1.t5'] },
    { id: 'm7', ends: ['KM1.t2', 'F2.t1'] },
    { id: 'm8', ends: ['KM1.t4', 'F2.t3'] },
    { id: 'm9', ends: ['KM1.t6', 'F2.t5'] },
    { id: 'm10', ends: ['F2.t2', 'M1.t_u'] },
    { id: 'm11', ends: ['F2.t4', 'M1.t_v'] },
    { id: 'm12', ends: ['F2.t6', 'M1.t_w'] },
    { id: 'pe', ends: ['X0.t_pe', 'M1.t_pe'], color: 'green-yellow', label: 'PE' },
    { id: 'c1', ends: ['L', 'F2a.t1'] },
    { id: 'c2', ends: ['F2a.t2', 'SB1.t1'] },
    { id: 'c3', ends: ['SB1.t2', 'SB2.t1'] },
    { id: 'c4', ends: ['SB2.t2', 'KM1c.t1'] },
    { id: 'c5', ends: ['KM1c.t2', 'N'] },
    { id: 'c6', ends: ['SB2.t1', 'KM1a.t1'] },
    { id: 'c7', ends: ['KM1a.t2', 'SB2.t2'] },
    { id: 'c8', ends: ['L', 'KM1b.t1'] },
    { id: 'c9', ends: ['KM1b.t2', 'H1.t1'] },
    { id: 'c10', ends: ['H1.t2', 'N'] },
  ],
  layout: {
    X0: { at: [40, 0] },
    Q1: { at: [40, 80] },
    KM1: { at: [40, 160] },
    F2: { at: [40, 240] },
    M1: { at: [40, 320] },
    F2a: { at: [200, 90] },
    SB1: { at: [200, 150] },
    SB2: { at: [200, 230] },
    KM1c: { at: [200, 310] },
    KM1a: { at: [260, 230] },
    KM1b: { at: [320, 230] },
    H1: { at: [320, 320] },
  },
};
