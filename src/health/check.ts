/**
 * Drawing health check: what the topology says that the picture does not.
 *
 * A CAD single-line diagram "looks right" while its lines may not touch and
 * its blocks may be loose strokes. This document has real topology and real
 * device kinds, so it can answer questions a drawing cannot: is everything
 * connected, does every device have a path to a supply, do voltage levels
 * meet only through a transformer, does a label say what the parameters say,
 * and how much load sits behind each bus and transformer.
 *
 * Positioning is "check hint" and "estimate", never compliance: nothing here
 * applies a code (NEC/IEC), and every rule is written to stay quiet when the
 * data to judge is missing. A false alarm costs more trust than a missed one,
 * so each rule below names the legitimate drawing it must not flag.
 *
 * Pure: (DiagramFile, InternalModel) → HealthReport. No store, no DOM.
 */

import type { DiagramFile, ParamValue } from '../model';
import type { InternalModel } from '../compiler/internal-model';
import {
  LOAD_KINDS,
  OFF_SUPPLY_CATEGORIES,
  OFF_SUPPLY_KINDS,
  ORIGIN_KINDS,
  RATED_KINDS,
  SERIES_PINS,
  UNWIRED_OK_KINDS,
  VOLTAGE_BOUNDARY_KINDS,
} from './roles';

export type HealthSeverity = 'error' | 'warning' | 'info';

export type HealthCode =
  /** A device (or bus) with none of its terminals wired. */
  | 'unwired'
  /** A wire that ends at a junction nothing else reaches. */
  | 'dangling-wire'
  /** A wire ends on top of another connection point (a junction, a
   *  terminal, a busbar) without being joined to it: it looks connected on
   *  the drawing and is not. The CAD failure this check exists for. */
  | 'looks-joined'
  /** The supply is drawn but feeds (almost) nothing: most of the drawing
   *  has no path to it. Reported once, on the supply, instead of as dozens
   *  of separate islands. */
  | 'supply-disconnected'
  /** A series device whose supply side is open (a note: often the panel's
   *  incoming end on a drawing that shows no supply). */
  | 'open-side'
  /** A series device whose downstream side is open: the feeder ends here. */
  | 'feeder-end'
  /** Devices with no path to any supply (only when the drawing has one). */
  | 'unsupplied'
  /** The drawing has equipment but no supply symbol (diagram-level hint). */
  | 'no-origin'
  /** Buses of different voltage joined without a transformer. */
  | 'voltage-mix'
  /** Transformer ratio disagrees with the buses on its two sides. */
  | 'ratio-mismatch'
  /** A number in the device's name disagrees with its parameter. */
  | 'label-mismatch'
  /** Known downstream load already exceeds the rating. */
  | 'overload';

export interface HealthIssue {
  /** Stable across edits: code + the first target. Dismissals key on it. */
  id: string;
  code: HealthCode;
  severity: HealthSeverity;
  /** Element / bus ids the issue is about (first = where the marker goes). */
  targets: string[];
  /** Values for the message template. */
  data?: Record<string, string | number>;
  /** The user marked this as intentional (`meta.healthDismissed`). */
  dismissed?: boolean;
}

export interface LoadSummary {
  /** Bus id, or element id for a transformer / UPS / busbar element. */
  targetId: string;
  targetType: 'bus' | 'element';
  /** Sum over loads whose rating is known. */
  knownKW: number;
  knownKVA: number;
  /** Loads with a known rating / all loads downstream. */
  known: number;
  total: number;
  /** Rating in kVA when the target has one (transformer, UPS). */
  ratingKVA?: number;
  /** knownKVA / ratingKVA × 100, a lower bound when known < total. */
  loadingPct?: number;
  /**
   * Other units (transformers / UPSs) feeding the same loads. The figures
   * above are then this unit's share — by rating, or equal when a rating is
   * missing — and `known` / `total` count the whole shared group.
   */
  parallelWith?: string[];
}

export interface HealthReport {
  issues: HealthIssue[];
  loads: LoadSummary[];
  /** At least one origin (grid, generator, PV, battery…) on the drawing. */
  hasOrigin: boolean;
  /** The drawing has electrical content at all (elements or buses). */
  hasModel: boolean;
}

// ── numbers ─────────────────────────────────────────────────────────────

function num(v: ParamValue | undefined): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*$/.exec(v);
    if (m) return Number(m[1]);
  }
  return undefined;
}

/** Two nominal voltages (kV) belong to the same level. Covers the LV family
 *  (380 / 400 / 415 V) and phase vs line voltage of one system (230 / 400 V),
 *  which a single drawing legitimately mixes. */
export function sameVoltageLevel(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) return true;
  const r = a > b ? a / b : b / a;
  return r <= 1.15 || (r >= 1.6 && r <= 1.85);
}

/** "10/0.4", "10kV/0.4kV", "11000/415", "13.8/0.48 kV" → [hv, lv] in kV.
 *  Unit-less numbers are read as kV unless ≥ 1000 — so "380/220" comes back
 *  as kV here, and the caller also tries it as volts. */
export function parseRatio(text: string): [number, number] | null {
  const m = /(\d+(?:\.\d+)?)\s*(kV|V)?[^/\d]*\/\s*(\d+(?:\.\d+)?)\s*(kV|V)?/i.exec(text);
  if (!m) return null;
  const tail = /\b(kV|V)\b/i.exec(text.slice(m.index + m[0].length))?.[1];
  const toKV = (v: number, unit?: string) =>
    unit ? (unit.toLowerCase() === 'v' ? v / 1000 : v) : v >= 1000 ? v / 1000 : v;
  const u2 = m[4] ?? tail;
  const u1 = m[2] ?? u2;
  let a = toKV(Number(m[1]), u1);
  let b = toKV(Number(m[3]), u2);
  // No units at all and one side in the thousands: both sides are volts
  // ("11000/415"), not 11 kV over 415 kV.
  if (!u1 && !u2 && Math.max(Number(m[1]), Number(m[3])) >= 1000) {
    a = Number(m[1]) / 1000;
    b = Number(m[3]) / 1000;
  }
  if (!(a > 0 && b > 0)) return null;
  return a >= b ? [a, b] : [b, a];
}

const UNIT_SCALE: Record<string, { dim: string; scale: number }> = {
  // Amps and kiloamps are different QUANTITIES on a breaker (rated current
  // vs breaking capacity), so they never compare: "63A" is not about Icu.
  a: { dim: 'I', scale: 1 },
  ka: { dim: 'Ik', scale: 1 },
  w: { dim: 'P', scale: 0.001 },
  kw: { dim: 'P', scale: 1 },
  mw: { dim: 'P', scale: 1000 },
  va: { dim: 'S', scale: 0.001 },
  kva: { dim: 'S', scale: 1 },
  mva: { dim: 'S', scale: 1000 },
  v: { dim: 'U', scale: 0.001 },
  kv: { dim: 'U', scale: 1 },
};

/** Distinct values per dimension written in a free-text name. A value next to
 *  a slash is part of a ratio ("10/0.4kV", "630A/25kA" is fine — different
 *  dimensions) and is ignored for its dimension. */
function namedValues(name: string): Map<string, number[]> {
  const out = new Map<string, number[]>();
  // The number must start a token: "R23-05A" is a model code, not 5 A.
  // A comma followed by one or two digits is a decimal comma ("15,5 kW");
  // followed by three it is a thousands separator ("1,250 A").
  const re = /(\/\s*)?(?<![\w.,-])(\d+(?:[.,]\d+)?)\s*(kVA|MVA|VA|kW|MW|W|kV|V|kA|A)\b(\s*\/)?/g;
  for (const m of name.matchAll(re)) {
    const u = UNIT_SCALE[m[3].toLowerCase()];
    if (!u) continue;
    // "16×150kW", "2 x 630A", "150kW ×16": a per-unit figure the parameter
    // rightly multiplies out. Not comparable — poison the dimension.
    const before = name.slice(Math.max(0, (m.index ?? 0) - 4), m.index);
    const after = name.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 4);
    if (/\d\s*[x×*]\s*$/i.test(before) || /^\s*[x×*]\s*\d/i.test(after)) {
      out.set(u.dim, [NaN]);
      continue;
    }
    if (m[1] || m[4]) {
      out.set(u.dim, [NaN]); // ratio: poison this dimension
      continue;
    }
    const raw = /,\d{3}$/.test(m[2]) ? m[2].replace(',', '') : m[2].replace(',', '.');
    const v = Number(raw) * u.scale;
    const list = out.get(u.dim) ?? [];
    if (!list.some((x) => Number.isNaN(x) || Math.abs(x - v) < 1e-9)) list.push(v);
    out.set(u.dim, list);
  }
  return out;
}

// ── graph ───────────────────────────────────────────────────────────────

interface Graph {
  /** device id → node ids its wired pins sit on (pin order kept, may repeat). */
  devNodes: Map<string, (string | undefined)[]>;
  /** node id → device ids touching it. */
  nodeDevs: Map<string, string[]>;
  /** bus id → node id. */
  busNode: Map<string, string>;
}

function buildGraph(m: InternalModel): Graph {
  const devNodes = new Map<string, (string | undefined)[]>();
  const nodeDevs = new Map<string, string[]>();
  for (const [id] of m.elements) {
    const refs = m.elementToTerminals.get(id) ?? [];
    const nodes = refs.map((r) => m.terminalToNode.get(r));
    devNodes.set(id, nodes);
    for (const n of nodes) {
      if (!n) continue;
      const list = nodeDevs.get(n) ?? [];
      if (!list.includes(id)) list.push(id);
      nodeDevs.set(n, list);
    }
  }
  const busNode = new Map<string, string>();
  for (const [id] of m.buses) {
    const n = m.terminalToNode.get(id);
    if (n) busNode.set(id, n);
  }
  return { devNodes, nodeDevs, busNode };
}

// ── the check ───────────────────────────────────────────────────────────

export function checkHealth(diagram: DiagramFile, m: InternalModel): HealthReport {
  const issues: HealthIssue[] = [];
  const hasModel = m.elements.size > 0 || m.buses.size > 0;
  const g = buildGraph(m);
  const kindOf = (id: string) => m.elements.get(id)?.element.kind ?? '';
  const categoryOf = (id: string) => m.elements.get(id)?.libraryDef?.category ?? '';
  const known = (id: string) => !!m.elements.get(id)?.libraryDef;
  // Never reported as unsupplied: control gear, instruments, relays, earthing.
  // A device sitting IN a conductor (an energy meter, a contactor) is always
  // judged, whatever its category.
  const offSupply = (id: string) =>
    !SERIES_PINS[kindOf(id)] &&
    (OFF_SUPPLY_KINDS.has(kindOf(id)) || OFF_SUPPLY_CATEGORIES.has(categoryOf(id)));
  // Does not carry supply on to what is behind it: earthing only. Control
  // contacts, push-buttons and coils DO pass it — a control circuit's loads
  // sit behind them, and blocking there made whole circuits read as
  // unsupplied in the 10-24 evaluation.
  const blocksSupply = (id: string) =>
    !SERIES_PINS[kindOf(id)] &&
    (categoryOf(id) === 'grounding' || ['earth', 'earthing-switch', 'arrester'].includes(kindOf(id)));
  const pinIds = (id: string) => (m.elements.get(id)?.libraryDef?.terminals ?? []).map((t) => t.id);
  const nodeOfPin = (id: string, pin: string) => {
    const i = pinIds(id).indexOf(pin);
    return i < 0 ? undefined : g.devNodes.get(id)?.[i];
  };

  const origins = [...m.elements.keys()].filter((id) => ORIGIN_KINDS.has(kindOf(id)));
  const hasOrigin = origins.length > 0;

  // 1. Supply walk. Loads are leaves (power ends there); off-supply devices
  //    neither receive nor pass it; custom kinds pass it (unknown ≠ broken).
  const reachedDev = new Set<string>();
  const reachedNode = new Set<string>();
  const propagates = (id: string) =>
    ORIGIN_KINDS.has(kindOf(id)) || (!LOAD_KINDS.has(kindOf(id)) && !blocksSupply(id));
  {
    const queue: string[] = [...origins];
    for (const o of origins) reachedDev.add(o);
    while (queue.length) {
      const d = queue.shift()!;
      if (!propagates(d)) continue;
      for (const n of g.devNodes.get(d) ?? []) {
        if (!n || reachedNode.has(n)) continue;
        reachedNode.add(n);
        for (const d2 of g.nodeDevs.get(n) ?? []) {
          if (reachedDev.has(d2) || blocksSupply(d2)) continue;
          reachedDev.add(d2);
          queue.push(d2);
        }
      }
    }
  }

  // 6 canvas units ≈ a few screen pixels at normal zoom: close enough that
  // the drawing reads as joined. Measured on real drawings: of wire ends that
  // stop near another connection point, nearly all are within 1 unit and the
  // rest within 6; past that there is a visible gap.
  const NEAR = 6;
  const near = (a: readonly [number, number], b: readonly [number, number]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1]) <= NEAR;
  const busUnder = (p: readonly [number, number]): string | null => {
    for (const [id, rb] of m.buses) {
      const { at, span, axis } = rb.geometry;
      const half = span / 2;
      if (axis === 'x' && Math.abs(p[1] - at[1]) <= NEAR && p[0] >= at[0] - half - NEAR && p[0] <= at[0] + half + NEAR) return id;
      if (axis === 'y' && Math.abs(p[0] - at[0]) <= NEAR && p[1] >= at[1] - half - NEAR && p[1] <= at[1] + half + NEAR) return id;
    }
    return null;
  };
  /** What an unwired device visibly sits on: a bus or another device's pin
   *  under one of its own pins. The commonest unwired case in the 10-25
   *  walkthrough was a breaker pushed onto a bus, which reads as connected. */
  const touching = (id: string): string | undefined => {
    for (const ref of m.elementToTerminals.get(id) ?? []) {
      const p = m.terminals.get(ref)?.world;
      if (!p) continue;
      const bus = busUnder(p);
      if (bus) return bus;
      for (const t of m.terminals.values()) {
        const owner = t.ref.slice(0, t.ref.indexOf('.'));
        if (owner !== id && near(t.world, p)) return owner;
      }
    }
    return undefined;
  };
  // 2. Wiring: unwired devices, open sides, feeder ends.
  const unwired = new Set<string>();
  const wiredPv = [...m.elements.keys()].some(
    (id) => kindOf(id) === 'pv' && (g.devNodes.get(id) ?? []).some(Boolean),
  );
  for (const [id, re] of m.elements) {
    const nodes = g.devNodes.get(id) ?? [];
    if (nodes.length === 0) continue; // no terminals at all
    if (nodes.every((n) => !n)) {
      unwired.add(id);
      if (!UNWIRED_OK_KINDS.has(re.element.kind)) {
        // An unwired PV module next to wired ones is usually the "typical
        // array" drawn for illustration (10-24 evaluation): a note, not a
        // warning.
        const illustrative = re.element.kind === 'pv' && wiredPv;
        const on = touching(id);
        issues.push({
          id: `unwired:${id}`,
          code: 'unwired',
          severity: illustrative ? 'info' : 'warning',
          targets: [id],
          ...(on ? { data: { touching: on } } : {}),
        });
      }
      continue;
    }
    const pair = SERIES_PINS[re.element.kind];
    if (!pair) continue;
    const a = nodeOfPin(id, pair[0]);
    const b = nodeOfPin(id, pair[1]);
    if (!!a === !!b) continue;
    const openPin = a ? pair[1] : pair[0];
    // Reached through its wired side → the open side faces away from the
    // supply: a feeder drawn to here and no further, which is a normal way to
    // draw an outgoing circuit. Not reached → it belongs to an unsupplied
    // island, which step 3 reports once for the whole group. Without any
    // supply on the drawing, fall back to the pin convention (second pin =
    // downstream).
    if (hasOrigin && !reachedDev.has(id)) continue;
    // Without a supply on the drawing, an open upstream side is just as often
    // the panel's incoming end drawn to here (10-24 evaluation: a main
    // breaker with nothing above it), so both directions are a note.
    const downstreamOpen = hasOrigin ? true : openPin === pair[1];
    issues.push(
      downstreamOpen
        ? { id: `feeder-end:${id}`, code: 'feeder-end', severity: 'info', targets: [id] }
        : { id: `open-side:${id}`, code: 'open-side', severity: 'info', targets: [id], data: { pin: openPin } },
    );
  }

  // A neutral or earth bar drawn for completeness carries no phase wiring
  // on a single-line diagram, and wires cross it without joining on purpose.
  const NEUTRAL_EARTH = /^(n|pe|pen|neutral|neutro|nulo|neutre|earth|ground|gnd|terra|tierra|terre|земл|нейтр|ноль)\b|零线|中性|接地|地线|地排/i;
  for (const [id, rb] of m.buses) {
    if (NEUTRAL_EARTH.test((rb.bus.name ?? '').trim())) continue;
    if (!g.busNode.has(id)) {
      issues.push({ id: `unwired:${id}`, code: 'unwired', severity: 'warning', targets: [id] });
    }
  }
  // Wire ends at a junction with nothing else attached. If another
  // connection point sits on the same spot, the drawing shows a joint that
  // the model does not have; otherwise the wire simply stops in mid-air.
  // A junction with no wire at all is invisible and ignored.
  for (const [id, rj] of m.junctions) {
    if (rj.degree !== 1) continue;
    const myNode = m.terminalToNode.get(id);
    // What the end sits on, so the panel can offer to join them in one click
    // (the end cannot be grabbed by hand there: the press lands on the pin's
    // device). Pins first, then joints, then buses, as the drop gesture does.
    const joins =
      [...m.terminals.values()].find((t) => near(t.world, rj.world) && m.terminalToNode.get(t.ref) !== myNode)?.ref ??
      [...m.junctions].find(([j2, r2]) => j2 !== id && near(r2.world, rj.world) && m.terminalToNode.get(j2) !== myNode)?.[0] ??
      busUnder(rj.world) ??
      undefined;
    issues.push(
      joins
        ? { id: `looks-joined:${id}`, code: 'looks-joined', severity: 'warning', targets: [id], data: { joins } }
        // A free wire end in open space is usually deliberate: an incoming
        // line from the utility, an outgoing feeder drawn to the page edge.
        // Worth a note, not a warning (10-24 evaluation: most free ends were
        // drawn that way on purpose).
        : { id: `dangling-wire:${id}`, code: 'dangling-wire', severity: 'info', targets: [id] },
    );
  }

  // 3. Unsupplied islands (only meaningful when a supply exists).
  if (hasOrigin) {
    const eligible = [...m.elements.keys()].filter(
      (id) => !offSupply(id) && !unwired.has(id) && !ORIGIN_KINDS.has(kindOf(id)),
    );
    const unreached = eligible.filter((id) => !reachedDev.has(id));
    if (unreached.length > 0 && unreached.length * 2 > eligible.length) {
      // Most of the drawing is cut off: the supply symbol is the thing that
      // is not connected (or is wired only to earth). One issue, on it.
      issues.push({
        id: `supply-disconnected:${origins.slice().sort()[0]}`,
        code: 'supply-disconnected',
        severity: 'warning',
        targets: origins.slice().sort(),
        data: { count: unreached.length, total: eligible.length },
      });
    }
  }
  if (hasOrigin && !issues.some((i) => i.code === 'supply-disconnected')) {
    const seen = new Set<string>();
    for (const [id] of m.elements) {
      if (seen.has(id) || reachedDev.has(id) || unwired.has(id) || offSupply(id)) continue;
      // Flood the unreached component through unreached nodes.
      const members: string[] = [];
      const nodes = new Set<string>();
      const stack = [id];
      seen.add(id);
      while (stack.length) {
        const d = stack.pop()!;
        // Control gear and instruments join the island (they connect it) but
        // are not listed as unsupplied themselves.
        if (!offSupply(d)) members.push(d);
        if (blocksSupply(d)) continue;
        for (const n of g.devNodes.get(d) ?? []) {
          if (!n || reachedNode.has(n) || nodes.has(n)) continue;
          nodes.add(n);
          for (const d2 of g.nodeDevs.get(n) ?? []) {
            if (seen.has(d2) || reachedDev.has(d2) || blocksSupply(d2)) continue;
            seen.add(d2);
            stack.push(d2);
          }
        }
      }
      if (members.length === 0) continue;
      const buses = [...g.busNode].filter(([, n]) => nodes.has(n)).map(([b]) => b);
      const targets = [...members.sort(), ...buses.sort()];
      issues.push({
        id: `unsupplied:${targets[0]}`,
        code: 'unsupplied',
        severity: 'warning',
        targets,
        data: { count: members.length },
      });
    }
  } else if (!hasOrigin && hasModel && [...m.elements.values()].some((re) => LOAD_KINDS.has(re.element.kind))) {
    issues.push({ id: 'no-origin', code: 'no-origin', severity: 'info', targets: [] });
  }

  // 4. Voltage zones: flood through everything except voltage boundaries.
  const zoneOf = new Map<string, number>();
  {
    let z = 0;
    for (const n of g.nodeDevs.keys()) if (!zoneOf.has(n)) floodZone(n, z++);
    for (const [, n] of g.busNode) if (!zoneOf.has(n)) floodZone(n, z++);
  }
  function floodZone(start: string, z: number) {
    const stack = [start];
    zoneOf.set(start, z);
    while (stack.length) {
      const n = stack.pop()!;
      for (const d of g.nodeDevs.get(n) ?? []) {
        if (VOLTAGE_BOUNDARY_KINDS.has(kindOf(d)) || !known(d)) continue;
        for (const n2 of g.devNodes.get(d) ?? []) {
          if (!n2 || zoneOf.has(n2)) continue;
          zoneOf.set(n2, z);
          stack.push(n2);
        }
      }
    }
  }
  const zoneVolts = new Map<number, { kv: number; bus: string }[]>();
  const noteVolt = (node: string | undefined, kv: number | undefined, bus: string) => {
    if (!node || kv === undefined || !(kv > 0)) return;
    const z = zoneOf.get(node);
    if (z === undefined) return;
    const list = zoneVolts.get(z) ?? [];
    list.push({ kv, bus });
    zoneVolts.set(z, list);
  };
  for (const [id, rb] of m.buses) noteVolt(g.busNode.get(id), num(rb.bus.params?.Un), id);
  for (const [id, re] of m.elements) {
    const k = re.element.kind;
    if (k === 'busbar') noteVolt(g.devNodes.get(id)?.[0], num(re.element.params?.Un), id);
    if (k === 'busduct') {
      const v = num(re.element.params?.Un);
      noteVolt(g.devNodes.get(id)?.find(Boolean), v === undefined ? undefined : v / 1000, id);
    }
  }
  /** Distinct voltage levels in a zone, or [] when unknown. */
  const levels = (z: number | undefined) => {
    const out: { kv: number; bus: string }[] = [];
    for (const v of (z === undefined ? undefined : zoneVolts.get(z)) ?? []) {
      if (!out.some((o) => sameVoltageLevel(o.kv, v.kv))) out.push(v);
    }
    return out;
  };
  for (const [z, vs] of zoneVolts) {
    const lv = levels(z);
    if (lv.length < 2) continue;
    const buses = [...new Set(vs.map((v) => v.bus))].sort();
    issues.push({
      id: `voltage-mix:${buses[0]}`,
      code: 'voltage-mix',
      severity: 'error',
      targets: buses,
      data: { a: lv[0].kv, b: lv[1].kv },
    });
  }

  // 5. Transformer ratio vs the voltage on each side.
  for (const [id, re] of m.elements) {
    if (re.element.kind !== 'transformer-2w') continue;
    const ratio = re.element.params?.ratio;
    if (typeof ratio !== 'string') continue;
    const parsed = parseRatio(ratio);
    if (!parsed) continue;
    const s1 = levels(zoneOf.get(nodeOfPin(id, 't1') ?? ''));
    const s2 = levels(zoneOf.get(nodeOfPin(id, 't2') ?? ''));
    if (s1.length !== 1 || s2.length !== 1) continue;
    const close = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b) <= 0.1;
    const fitsAs = ([hv, lv]: [number, number]) =>
      (close(hv, s1[0].kv) && close(lv, s2[0].kv)) || (close(hv, s2[0].kv) && close(lv, s1[0].kv));
    const unitless = !/\bk?V\b/i.test(ratio);
    const fits =
      fitsAs(parsed) || (unitless && fitsAs([parsed[0] / 1000, parsed[1] / 1000]));
    if (!fits) {
      issues.push({
        id: `ratio-mismatch:${id}`,
        code: 'ratio-mismatch',
        severity: 'warning',
        targets: [id],
        data: { ratio, a: s1[0].kv, b: s2[0].kv },
      });
    }
  }

  // 6. Name vs parameters, same device, same dimension, unambiguous only.
  for (const [id, re] of m.elements) {
    const name = re.element.name;
    const def = re.libraryDef;
    if (!name || !def?.params) continue;
    const named = namedValues(name);
    if (named.size === 0) continue;
    for (const p of def.params) {
      const u = p.unit ? UNIT_SCALE[p.unit.toLowerCase()] : undefined;
      const v = num(re.element.params?.[p.name]);
      if (!u || v === undefined) continue;
      const inName = named.get(u.dim);
      if (!inName || inName.length !== 1 || Number.isNaN(inName[0])) continue;
      const pv = v * u.scale;
      if (Math.abs(pv - inName[0]) / Math.max(Math.abs(pv), Math.abs(inName[0]), 1e-9) > 0.01) {
        issues.push({
          id: `label-mismatch:${id}:${p.name}`,
          code: 'label-mismatch',
          severity: 'warning',
          targets: [id],
          data: { param: p.name, value: `${v}${p.unit ?? ''}` },
        });
      }
    }
  }

  // 7. Load roll-up behind buses, transformers and UPSs.
  const loads: LoadSummary[] = [];
  if (hasOrigin) {
    const loadRating = (id: string): { kw: number; kva: number } | null => {
      const re = m.elements.get(id)!;
      const k = re.element.kind;
      const p = num(re.element.params?.P);
      if (p === undefined || !(p > 0)) return null;
      // load.P is MW, the rest kW. Motors and EV chargers had no P before
      // 2026-10-24 and the AI sometimes wrote one in MW (0.0075 for 7.5 kW);
      // nothing in those kinds is rated under 50 W, so read that as MW.
      const legacyMW = (k.endsWith('-motor') || k === 'ev-charger') && p < 0.05;
      const kw = k === 'load' || legacyMW ? p * 1000 : p;
      const pf = num(re.element.params?.cosphi);
      const cos = pf && pf > 0 && pf <= 1 ? pf : k === 'heater' ? 1 : 0.9;
      return { kw, kva: kw / cos };
    };
    /** Devices in the component of `startNodes` once `cut` is removed. */
    const behind = (startNodes: string[], cutDev: string | null, cutNode: string | null) => {
      const devs = new Set<string>();
      const nodes = new Set<string>(startNodes);
      const stack = [...startNodes];
      while (stack.length) {
        const n = stack.pop()!;
        for (const d of g.nodeDevs.get(n) ?? []) {
          if (d === cutDev || devs.has(d)) continue;
          devs.add(d);
          if (LOAD_KINDS.has(kindOf(d)) || blocksSupply(d)) continue;
          for (const n2 of g.devNodes.get(d) ?? []) {
            if (!n2 || n2 === cutNode || nodes.has(n2)) continue;
            nodes.add(n2);
            stack.push(n2);
          }
        }
      }
      return devs;
    };
    const sum = (devs: Iterable<string>) => {
      let kw = 0, kva = 0, k = 0, t = 0;
      for (const d of devs) {
        if (!LOAD_KINDS.has(kindOf(d))) continue;
        t++;
        const r = loadRating(d);
        if (r) { k++; kw += r.kw; kva += r.kva; }
      }
      return { kw, kva, k, t };
    };
    const hasOriginIn = (devs: Set<string>) => [...devs].some((d) => ORIGIN_KINDS.has(kindOf(d)));

    // Buses (and busbar elements): every branch hanging off the bus that does
    // not lead back to a supply is downstream.
    const busTargets: { id: string; type: 'bus' | 'element'; node: string }[] = [
      ...[...g.busNode].map(([id, node]) => ({ id, type: 'bus' as const, node })),
      ...[...m.elements]
        .filter(([, re]) => re.element.kind === 'busbar')
        .map(([id]) => ({ id, type: 'element' as const, node: g.devNodes.get(id)?.[0] }))
        .filter((t): t is { id: string; type: 'element'; node: string } => !!t.node),
    ];
    for (const t of busTargets) {
      if (!reachedNode.has(t.node)) continue;
      const down = new Set<string>();
      for (const d of g.nodeDevs.get(t.node) ?? []) {
        if (t.type === 'element' && d === t.id) continue;
        if (LOAD_KINDS.has(kindOf(d))) { down.add(d); continue; }
        const branchNodes = (g.devNodes.get(d) ?? []).filter((n): n is string => !!n && n !== t.node);
        const branch = behind(branchNodes, null, t.node);
        branch.add(d);
        if (!hasOriginIn(branch)) for (const x of branch) down.add(x);
      }
      const s = sum(down);
      if (s.t === 0) continue;
      loads.push({ targetId: t.id, targetType: t.type, knownKW: s.kw, knownKVA: s.kva, known: s.k, total: s.t });
    }
    // Transformers / UPS: the output side, unless only the input side is
    // supply-free (a drawing fed from below).
    const units: { id: string; down: Set<string>; ratingKVA?: number }[] = [];
    for (const [id, re] of m.elements) {
      const rated = RATED_KINDS[re.element.kind];
      const pair = SERIES_PINS[re.element.kind];
      if (!rated || !pair || !reachedDev.has(id)) continue;
      const inN = nodeOfPin(id, pair[0]);
      const outN = nodeOfPin(id, pair[1]);
      if (!inN || !outN) continue;
      let down = behind([outN], id, null);
      if (hasOriginIn(down)) {
        const up = behind([inN], id, null);
        if (!hasOriginIn(up)) down = up;
      }
      const loadsBehind = new Set([...down].filter((d) => LOAD_KINDS.has(kindOf(d))));
      if (loadsBehind.size === 0) continue;
      const rating = num(re.element.params?.[rated.param]);
      units.push({ id, down: loadsBehind, ...(rating && rating > 0 ? { ratingKVA: rating * rated.toKVA } : {}) });
    }
    // Units that feed the same loads run in parallel (two transformers onto
    // one bus, or onto two halves joined by a closed tie): the load is shared,
    // not carried by each in full. The 10-25 walkthrough found both of a pair
    // showing the whole board at 80% each. Share by rating, which is how
    // equal-impedance units divide it; equally when a rating is missing.
    const group = new Map<string, string[]>();
    for (const u of units) {
      const mates = units.filter((v) => [...u.down].some((d) => v.down.has(d))).map((v) => v.id);
      group.set(u.id, mates);
    }
    for (const u of units) {
      // Close the group transitively (A shares with B, B with C).
      const ids = new Set<string>([u.id]);
      const stack = [u.id];
      while (stack.length) for (const v of group.get(stack.pop()!) ?? []) if (!ids.has(v)) { ids.add(v); stack.push(v); }
      const mates = units.filter((v) => ids.has(v.id));
      const shared = new Set<string>();
      for (const v of mates) for (const d of v.down) shared.add(d);
      const s = sum(shared);
      const allRated = mates.every((v) => v.ratingKVA);
      const share = mates.length === 1
        ? 1
        : allRated
          ? u.ratingKVA! / mates.reduce((acc, v) => acc + v.ratingKVA!, 0)
          : 1 / mates.length;
      const kva = s.kva * share;
      const ratingKVA = u.ratingKVA;
      const summary: LoadSummary = {
        targetId: u.id, targetType: 'element', knownKW: s.kw * share, knownKVA: kva, known: s.k, total: s.t,
        ...(ratingKVA ? { ratingKVA, loadingPct: (kva / ratingKVA) * 100 } : {}),
        ...(mates.length > 1 ? { parallelWith: mates.filter((v) => v.id !== u.id).map((v) => v.id) } : {}),
      };
      loads.push(summary);
      // Unknown loads can only add to the total, so a known sum over the
      // rating stays over it whatever the rest turn out to be. But the sum is
      // of nameplate ratings with no diversity factor, and loads rarely peak
      // together: up to 125% is a note, beyond that a warning. Far beyond
      // (10×) is almost always a unit slip in the loads (P is in MW on the
      // generic load), and the message says so.
      if (ratingKVA && kva > ratingKVA) {
        const ratioLoad = kva / ratingKVA;
        issues.push({
          id: `overload:${u.id}`,
          code: 'overload',
          severity: ratioLoad > 1.25 ? 'warning' : 'info',
          targets: [u.id],
          data: {
            load: Math.round(kva),
            rating: Math.round(ratingKVA),
            ...(ratioLoad > 10 ? { units: 1 } : {}),
          },
        });
      }
    }
  }

  const dismissed = new Set(diagram.meta?.healthDismissed ?? []);
  for (const i of issues) if (dismissed.has(i.id)) i.dismissed = true;
  return { issues, loads, hasOrigin, hasModel };
}
