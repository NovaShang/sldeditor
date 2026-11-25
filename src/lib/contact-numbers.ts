/**
 * Contacts of a device and their terminal numbers, the way circuit diagrams
 * number them (IEC 60947-5-1 / EN 50005).
 *
 * A device on a circuit diagram is drawn in pieces that share one tag: the
 * coil of -KM1 sits in the control circuit, its main contacts in the power
 * circuit and its auxiliary contacts wherever they switch something. The tag
 * is what ties them together, so "the contacts of -KM1" are simply the
 * elements named -KM1.
 *
 * Auxiliary contacts carry a two-digit number per terminal: the first digit
 * is the contact's place in the device (1, 2, 3…), unique within it; the
 * second is its function — 1-2 break (NC), 3-4 make (NO), 5-6 and 7-8 the
 * delayed or otherwise special break / make. So the contacts of one contactor
 * read 13-14, 21-22, 33-34, 41-42…, and a timer's delayed contacts 55-56,
 * 67-68. Main (power) contacts are numbered 1-2 / 3-4 / 5-6 and are not part
 * of the sequence.
 *
 * Every number here is derived from the library's own pin labels: a contact
 * keeps its function digit and only its sequence digit is chosen, so no
 * numbering is invented that the symbol does not already carry.
 */

import { libraryById } from '../element-library';
import { pinLabelOf } from '../model/diagram-type';
import type { LibraryEntry } from '../model/library';
import type { DiagramFile, Element, ElementId } from '../model/types';

/** Auxiliary contacts: their tag is their operator's. */
export const AUX_CONTACT_KINDS: ReadonlySet<string> = new Set([
  'make-contact',
  'break-contact',
  'on-delay-make-contact',
  'on-delay-break-contact',
  'off-delay-make-contact',
  'off-delay-break-contact',
  'changeover-contact',
]);

/** Operators — the coil end of a device — and its main contacts. */
const OPERATOR_KINDS: ReadonlySet<string> = new Set([
  'relay-coil',
  'time-relay',
  'contactor',
  'contactor-2p',
  'contactor-3p',
]);

/** A contact the "add contact" action offers. */
export interface ContactOption {
  kind: string;
  /** Message key of its menu label. */
  labelKey:
    | 'contacts.no'
    | 'contacts.nc'
    | 'contacts.changeover'
    | 'contacts.onDelayNo'
    | 'contacts.onDelayNc'
    | 'contacts.offDelayNo'
    | 'contacts.offDelayNc'
    | 'contacts.main';
}

const RELAY_OPTIONS: ContactOption[] = [
  { kind: 'make-contact', labelKey: 'contacts.no' },
  { kind: 'break-contact', labelKey: 'contacts.nc' },
  { kind: 'changeover-contact', labelKey: 'contacts.changeover' },
];

const TIMER_OPTIONS: ContactOption[] = [
  { kind: 'on-delay-make-contact', labelKey: 'contacts.onDelayNo' },
  { kind: 'on-delay-break-contact', labelKey: 'contacts.onDelayNc' },
  { kind: 'off-delay-make-contact', labelKey: 'contacts.offDelayNo' },
  { kind: 'off-delay-break-contact', labelKey: 'contacts.offDelayNc' },
];

/** A tag as compared: no leading "-", no surrounding space, upper case. */
export function normalizeTag(name: string | undefined): string {
  return (name ?? '').trim().replace(/^-/, '').toUpperCase();
}

/** Every element carrying `tag` — the pieces of one device. */
export function deviceMembers(diagram: DiagramFile, tag: string): Element[] {
  const key = normalizeTag(tag);
  if (!key) return [];
  return diagram.elements.filter((e) => normalizeTag(e.name) === key);
}

/**
 * The device `el` is part of, when it is a piece of a device contacts can be
 * added to: an operator (coil, timer, contactor) or a contact of one, with a
 * tag. Null otherwise — an unnamed contact belongs to nothing yet.
 */
export function contactDeviceOf(diagram: DiagramFile, el: Element): { tag: string; members: Element[] } | null {
  if (!OPERATOR_KINDS.has(el.kind) && !AUX_CONTACT_KINDS.has(el.kind)) return null;
  const tag = (el.name ?? '').trim();
  if (!normalizeTag(tag)) return null;
  const members = deviceMembers(diagram, tag);
  // A lone contact names a device only if something else carries the tag.
  if (!OPERATOR_KINDS.has(el.kind) && !members.some((m) => m.id !== el.id && OPERATOR_KINDS.has(m.kind))) {
    return null;
  }
  return { tag, members };
}

/**
 * The contacts `add contact` offers for a device: make / break for every
 * relay and contactor, the delayed ones as well when the device is a timer,
 * and the 3-pole main contacts for a contactor (-KM) that has none drawn yet.
 */
export function contactOptions(members: readonly Element[], tag: string): ContactOption[] {
  const timer = members.some((m) => m.kind === 'time-relay' || m.kind.includes('delay-'));
  const out = [...RELAY_OPTIONS, ...(timer ? TIMER_OPTIONS : [])];
  const contactor = /^KM\d/.test(normalizeTag(tag)) || members.some((m) => m.kind === 'contactor');
  if (contactor && !members.some((m) => m.kind === 'contactor-3p' || m.kind === 'contactor-2p')) {
    out.push({ kind: 'contactor-3p', labelKey: 'contacts.main' });
  }
  return out;
}

const AUX_NUMBER = /^(\d+)(\d)$/;

function entryOf(kind: string, library?: ReadonlyMap<string, LibraryEntry>): LibraryEntry | undefined {
  return library?.get(kind) ?? libraryById[kind];
}

/** Terminals of `entry` numbered the auxiliary way (two digits or more). */
function numberedTerminals(entry: LibraryEntry | undefined): { id: string; fn: string; seq: number }[] {
  const out: { id: string; fn: string; seq: number }[] = [];
  for (const t of entry?.terminals ?? []) {
    const m = t.label ? AUX_NUMBER.exec(t.label) : null;
    if (m) out.push({ id: t.id, fn: m[2], seq: Number(m[1]) });
  }
  return out;
}

/** Sequence digits the device's contacts already use. */
export function usedSequences(
  diagram: DiagramFile,
  tag: string,
  exclude?: ElementId,
  library?: ReadonlyMap<string, LibraryEntry>,
): Set<number> {
  const used = new Set<number>();
  for (const m of deviceMembers(diagram, tag)) {
    if (m.id === exclude) continue;
    const entry = entryOf(m.kind, library);
    for (const t of entry?.terminals ?? []) {
      const label = pinLabelOf(m, entry, t.id);
      const hit = label ? AUX_NUMBER.exec(label) : null;
      if (hit) used.add(Number(hit[1]));
    }
  }
  return used;
}

/**
 * Terminal numbers for a new `kind` contact of device `tag`: the library's
 * own numbers when their sequence digit is still free on the device (the
 * first make contact is 13-14, a timer's first delayed break 55-56), else the
 * lowest free sequence digit with the contact's function digits — the second
 * make contact of -KM1 is 23-24, then 33-34. Null for a symbol without
 * auxiliary numbers (main contacts keep 1-2 / 3-4 / 5-6).
 */
export function nextContactPins(
  diagram: DiagramFile,
  tag: string,
  kind: string,
  exclude?: ElementId,
  library?: ReadonlyMap<string, LibraryEntry>,
): Record<string, string> | null {
  const terms = numberedTerminals(entryOf(kind, library));
  if (terms.length === 0) return null;
  const used = usedSequences(diagram, tag, exclude, library);
  let seq = terms[0].seq;
  if (used.has(seq)) {
    seq = 1;
    while (used.has(seq)) seq++;
  }
  const out: Record<string, string> = {};
  for (const t of terms) out[t.id] = `${seq}${t.fn}`;
  return out;
}

/**
 * `pins` as the element's `pinLabels`: only the pins that differ from the
 * library, other overrides kept; undefined when nothing is left.
 */
export function pinLabelsWith(
  el: Pick<Element, 'kind' | 'pinLabels'>,
  pins: Record<string, string>,
  library?: ReadonlyMap<string, LibraryEntry>,
): Record<string, string> | undefined {
  const entry = entryOf(el.kind, library);
  const next: Record<string, string> = { ...(el.pinLabels ?? {}) };
  for (const [id, label] of Object.entries(pins)) {
    const own = entry?.terminals.find((t) => t.id === id)?.label;
    if (own === label) delete next[id];
    else next[id] = label;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * Renaming an auxiliary contact to the tag of an existing device ("-KM1")
 * gives it the device's next free terminal numbers — unless the numbers it
 * already has are free there, which they are for the first contact of a kind
 * and for numbers the user typed on purpose. Returns the `pinLabels` to set
 * (undefined clears them), or `null` to leave the pins alone.
 */
export function pinLabelsOnRename(
  diagram: DiagramFile,
  id: ElementId,
  name: string | undefined,
  library?: ReadonlyMap<string, LibraryEntry>,
): Record<string, string> | undefined | null {
  const el = diagram.elements.find((e) => e.id === id);
  if (!el || !AUX_CONTACT_KINDS.has(el.kind)) return null;
  if (!normalizeTag(name) || normalizeTag(name) === normalizeTag(el.name)) return null;
  const others = deviceMembers(diagram, name!).filter((m) => m.id !== id);
  if (others.length === 0) return null;
  const entry = entryOf(el.kind, library);
  const used = usedSequences(diagram, name!, id, library);
  const mine = numberedTerminals(entry)
    .map((t) => AUX_NUMBER.exec(pinLabelOf(el, entry, t.id) ?? ''))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
  if (mine.length > 0 && mine.every((s) => !used.has(s))) return null;
  const pins = nextContactPins(diagram, name!, el.kind, id, library);
  if (!pins) return null;
  return pinLabelsWith(el, pins, library);
}
