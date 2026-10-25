/**
 * What each library kind IS, electrically, for the health check.
 *
 * The library knows symbols, not circuits: there is no input/output flag on a
 * terminal and no "this is a source" field on an entry. These tables supply
 * exactly as much circuit knowledge as the checks need and no more, keyed by
 * kind id so a custom kind (unknown here) is simply left out of every check
 * except "not wired at all".
 */

/** Where power comes from. Converters with an input side (UPS, power supply,
 *  inverter) are NOT origins — they pass power through. */
export const ORIGIN_KINDS: ReadonlySet<string> = new Set([
  'grid-source',
  'generator',
  'genset',
  'pv',
  'wind-turbine',
  'battery',
]);

/**
 * Two-sided devices that sit IN a conductor. One side wired and the other
 * open is worth a look; both wired is the normal state. Pairs are the pins
 * that must both be connected for current to pass.
 */
export const SERIES_PINS: Readonly<Record<string, readonly [string, string]>> = {
  breaker: ['t1', 't2'],
  fuse: ['t1', 't2'],
  disconnector: ['t1', 't2'],
  'load-switch': ['t1', 't2'],
  'fuse-switch-disconnector': ['t1', 't2'],
  'dc-disconnector': ['t1', 't2'],
  'gfci-breaker': ['t1', 't2'],
  rcd: ['t1', 't2'],
  recloser: ['t1', 't2'],
  contactor: ['t1', 't2'],
  'thermal-overload': ['t1', 't2'],
  'energy-meter': ['t1', 't2'],
  'transformer-2w': ['t1', 't2'],
  'voltage-regulator': ['t1', 't2'],
  ups: ['t_in', 't_out'],
  vfd: ['t_in', 't_out'],
  'soft-starter': ['t_in', 't_out'],
  inverter: ['t_dc', 't_ac'],
  'converter-bidir': ['t_ac', 't_dc'],
  'dc-dc-converter': ['t_in', 't_out'],
  rectifier: ['t_ac', 't_dc'],
  busduct: ['t_left', 't_right'],
};

/**
 * Devices that change voltage. They carry power (so they do not break the
 * "is it supplied?" walk) but they bound a voltage zone: two buses on either
 * side of one may legitimately differ.
 */
export const VOLTAGE_BOUNDARY_KINDS: ReadonlySet<string> = new Set([
  'transformer-2w',
  'transformer-3w',
  'autotransformer',
  'voltage-regulator',
  'grounding-transformer',
  'ups',
  'power-supply',
  'inverter',
  'converter-bidir',
  'dc-dc-converter',
  'rectifier',
  'mppt',
  'vfd',
  'pt',
  'ct',
]);

/**
 * Categories left out of the supply walk. Control circuits are routinely
 * drawn without their supply on the same sheet, earthing is not a supply
 * path, and relays/instruments are often placed next to the gear they watch
 * without a wire — flagging any of these as "unsupplied" would be noise.
 */
export const OFF_SUPPLY_CATEGORIES: ReadonlySet<string> = new Set([
  'control',
  'grounding',
  'measurement',
]);

export const OFF_SUPPLY_KINDS: ReadonlySet<string> = new Set([
  'earth',
  'earthing-switch',
  'arrester',
  'buchholz-relay',
  'distance-relay',
  'overcurrent-relay',
  'phase-failure-relay',
  'protective-relay',
  'reverse-power-relay',
  'undervoltage-relay',
]);

/** Single-pin auxiliaries routinely drawn unwired beside the gear they watch. */
export const UNWIRED_OK_KINDS: ReadonlySet<string> = new Set([
  'earth',
  // Instrument transformers are routinely drawn ON a conductor rather than
  // wired into it; the circuit is whole either way.
  'ct',
  'pt',
  'buchholz-relay',
  'distance-relay',
  'overcurrent-relay',
  'phase-failure-relay',
  'protective-relay',
  'reverse-power-relay',
  'undervoltage-relay',
  'ammeter',
  'voltmeter',
  'wattmeter',
  'varmeter',
  'frequency-meter',
  'power-factor-meter',
  'synchronoscope',
]);

/** Loads: leaves of the supply graph, and what the roll-up adds up. */
export const LOAD_KINDS: ReadonlySet<string> = new Set([
  'load',
  'heater',
  'async-motor',
  'sync-motor',
  'dc-motor',
  'ev-charger',
  'socket-outlet',
  'luminaire',
  'panelboard',
]);

/** Kinds whose rating the roll-up is measured against, and the param. */
export const RATED_KINDS: Readonly<Record<string, { param: string; toKVA: number }>> = {
  'transformer-2w': { param: 'S', toKVA: 1000 }, // MVA
  ups: { param: 'S', toKVA: 1 }, // kVA
};
