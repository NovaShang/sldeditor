/**
 * Circuit diagrams say "rail", never "bus".
 *
 * A circuit diagram's supply rails (L / N, +24V / 0V, L1–L3 / PE) are the
 * same `Bus` objects a single-line diagram calls busbars, drawn with the same
 * tool — but "busbar" is switchgear vocabulary, and a control-circuit user
 * reading it reaches for wires instead. Every string that names a bus has a
 * circuit-diagram twin; components ask for the key through `termKey` and the
 * single-line wording stays exactly as it was.
 */

import type { LocaleKey } from './messages';

const CIRCUIT_TERMS: Partial<Record<LocaleKey, LocaleKey>> = {
  'tool.bus': 'tool.rail',
  'tool.busHint': 'tool.railHint',
  'mode.busInit': 'mode.railInit',
  'mode.busDragging': 'mode.railDragging',
  'props.bus': 'props.rail',
  'onboard.step3.title': 'onboard.rail.title',
  'onboard.step3.body': 'onboard.rail.body',
  'tool.wireHint': 'tool.wireHintCircuit',
  'mode.wireDragging': 'mode.wireDraggingCircuit',
  'tool.placeHint': 'tool.placeHintCircuit',
  'mode.placeNormal': 'mode.placeNormalCircuit',
  'cat.busbar': 'cat.busbarCircuit',
};

/** The key to show for `key` in a drawing of this type. */
export function termKey(key: LocaleKey, circuit: boolean): LocaleKey {
  return (circuit && CIRCUIT_TERMS[key]) || key;
}
