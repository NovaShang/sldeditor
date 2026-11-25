/**
 * Power-rating units: W / kW / MW, VA / kVA / MVA, var / kvar / Mvar.
 *
 * A library param keeps ONE unit for what is stored (`LibraryParamField.unit`:
 * the generic load's `P` is in MW, a transformer's `S` in MVA) — that is the
 * document's meaning and never changes, so no existing drawing changes value.
 * What changes is how the number is shown and typed:
 *
 *  - Display: a value below 1 in a mega-unit is spelled out in the smaller
 *    unit (`0.006` MVA → `6kVA`, `0.0005` MW → `500W`). Values of 1 and more
 *    stay as they were (`2.5MVA`), as do kilo- and base-unit params, so the
 *    labels of drawings with sensible ratings render exactly as before.
 *  - Entry: the property panel offers the family's units and converts what is
 *    typed back to the stored unit (`6` kW → `0.006` MW); a typed suffix
 *    (`6 kW`) works too.
 */

export interface PowerUnitFamily {
  /** Units smallest first: base, kilo, mega. */
  units: readonly [string, string, string];
}

const FAMILIES: readonly PowerUnitFamily[] = [
  { units: ['W', 'kW', 'MW'] },
  { units: ['VA', 'kVA', 'MVA'] },
  { units: ['var', 'kvar', 'Mvar'] },
];

/** Spellings accepted for each unit (lower-cased), beyond the canonical one. */
const ALIASES: Record<string, string> = {
  w: 'W',
  kw: 'kW',
  mw: 'MW',
  va: 'VA',
  kva: 'kVA',
  mva: 'MVA',
  var: 'var',
  kvar: 'kvar',
  mvar: 'Mvar',
};

interface Located {
  family: PowerUnitFamily;
  /** Power of 1000: 0 base, 1 kilo, 2 mega. */
  step: number;
  unit: string;
}

function locate(unit: string | undefined): Located | null {
  if (!unit) return null;
  const canon = ALIASES[unit.trim().toLowerCase()];
  if (!canon) return null;
  for (const family of FAMILIES) {
    const step = family.units.indexOf(canon);
    if (step >= 0) return { family, step, unit: canon };
  }
  return null;
}

/** The units a param stored in `unit` can be shown / typed in, or null. */
export function powerUnitChoices(unit: string | undefined): readonly string[] | null {
  return locate(unit)?.family.units ?? null;
}

/** Twelve significant digits: enough for any rating, none of the float dust. */
function clean(n: number): number {
  return Number(n.toPrecision(12));
}

/** `value` stored in `from`, expressed in `to` (same family). */
export function convertPower(value: number, from: string, to: string): number {
  const a = locate(from);
  const b = locate(to);
  if (!a || !b || a.family !== b.family || a.step === b.step) return value;
  return clean(value * 1000 ** (a.step - b.step));
}

/**
 * The unit a stored value reads best in: a mega-unit value below 1 drops to
 * kilo (or base below 0.001). Anything else keeps its stored unit.
 */
export function displayPowerUnit(value: number | undefined, unit: string): string {
  const at = locate(unit);
  if (!at || at.step !== 2 || value === undefined || !Number.isFinite(value) || value === 0) {
    return unit;
  }
  const abs = Math.abs(value);
  if (abs >= 1) return unit;
  return abs >= 0.001 ? at.family.units[1] : at.family.units[0];
}

/**
 * Canvas / export label text for a param value: `${value}${unit}`, with a
 * small mega-unit power spelled out in the smaller unit.
 */
export function formatParamValue(value: unknown, unit: string | undefined): string {
  if (typeof value === 'number' && unit && locate(unit)) {
    const shown = displayPowerUnit(value, unit);
    return `${convertPower(value, unit, shown)}${shown}`;
  }
  return `${value}${unit ?? ''}`;
}

/**
 * Parse what a user typed into a power field: a number, optionally followed
 * by a unit of the same family (`6`, `6kW`, `6 kva`). The number is read in
 * `typedUnit` when no suffix is given. Returns the value in `storedUnit`, or
 * null when the text is not a number (or names a unit of another family).
 */
export function parsePowerInput(
  text: string,
  typedUnit: string,
  storedUnit: string,
): number | null {
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*([a-zA-Z]*)\s*$/.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const stored = locate(storedUnit);
  if (!stored) return null;
  let from = typedUnit;
  if (m[2]) {
    const typed = locate(m[2]);
    if (!typed || typed.family !== stored.family) return null;
    from = typed.unit;
  }
  return convertPower(n, from, stored.unit);
}
