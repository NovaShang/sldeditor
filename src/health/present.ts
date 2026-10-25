/**
 * Turning a health issue into words and a place on the canvas. Shared by the
 * canvas markers and the checks panel so the two never disagree about where
 * an issue is or what it says.
 */

import type { InternalModel } from '../compiler/internal-model';
import { transformPoint } from '../compiler';
import type { LocaleKey } from '../i18n';
import { libText } from '../i18n/library';
import type { HealthIssue } from './check';

type T = (key: LocaleKey, params?: Record<string, string | number>) => string;

/** The kind's display name in the current locale, without the trailing
 *  designation some carry ("断路器 (QF)" → "断路器"). */
function kindName(internal: InternalModel, id: string): string | null {
  const re = internal.elements.get(id);
  if (!re) return null;
  const k = re.element.kind;
  return libText(`${k}.name`, re.libraryDef?.name ?? k).replace(/\s*[(（][^()（）]*[)）]\s*$/, '');
}

function ownName(internal: InternalModel, id: string): string | null {
  const el = internal.elements.get(id)?.element;
  if (el) return (el.name ?? '').split(/\r\n|\r|\n/)[0].trim() || null;
  const bus = internal.buses.get(id)?.bus;
  if (bus) return bus.name?.trim() || null;
  return null;
}

/**
 * Short display name: the device's own name (first line), else what it is
 * ("Circuit breaker"), else its id. Ids like "e12" mean nothing to the user
 * (10-25 walkthrough), and a click on the issue selects the device anyway.
 */
export function targetName(internal: InternalModel, id: string, t?: T): string {
  const own = ownName(internal, id);
  if (own) return own;
  if (internal.buses.has(id)) return t ? t('health.bus') : id;
  return kindName(internal, id) ?? id;
}

/** Name plus what it is, for messages: "QF3 (Circuit breaker)". */
export function targetLabel(internal: InternalModel, id: string, t?: T): string {
  const own = ownName(internal, id);
  const kind = kindName(internal, id);
  if (own && kind) return `${own} (${kind})`;
  return targetName(internal, id, t);
}

/** Up to three names, then "…": enough to recognise the group. */
function nameList(internal: InternalModel, ids: string[], t: T): string {
  const devices = ids.filter((id) => internal.elements.has(id));
  const names = [...new Set(devices.map((id) => targetName(internal, id, t)))];
  return names.slice(0, 3).join(', ') + (names.length > 3 ? ', …' : '');
}

const fmt = (v: string | number | undefined) =>
  typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : (v ?? '');

export function issueText(t: T, internal: InternalModel, issue: HealthIssue): string {
  const d = issue.data ?? {};
  const params: Record<string, string | number> = {
    name: issue.targets[0] ? targetLabel(internal, issue.targets[0], t) : '',
    names: nameList(internal, issue.targets, t),
    other: typeof d.touching === 'string' ? targetName(internal, d.touching, t) : '',
    count: fmt(d.count),
    total: fmt(d.total),
    a: fmt(d.a),
    b: fmt(d.b),
    ratio: fmt(d.ratio),
    param: fmt(d.param),
    value: fmt(d.value),
    load: fmt(d.load),
    rating: fmt(d.rating),
  };
  const key = issue.code === 'unwired' && d.touching ? 'health.code.unwired-touching' : `health.code.${issue.code}`;
  const main = t(key as LocaleKey, params);
  return d.units ? `${main} ${t('health.overloadUnits')}` : main;
}

/** World bounding box of an element, bus or junction, or null. */
export function targetBox(
  internal: InternalModel,
  id: string,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const re = internal.elements.get(id);
  const place = internal.layout.get(id);
  if (re?.libraryDef && place) {
    const vb = re.libraryDef.viewBox.trim().split(/\s+/).map(Number);
    if (vb.length === 4 && vb.every((n) => Number.isFinite(n))) {
      const [x, y, w, h] = vb;
      const pts = ([[x, y], [x + w, y], [x + w, y + h], [x, y + h]] as [number, number][]).map((c) =>
        transformPoint(c, place),
      );
      return {
        minX: Math.min(...pts.map((p) => p[0])),
        maxX: Math.max(...pts.map((p) => p[0])),
        minY: Math.min(...pts.map((p) => p[1])),
        maxY: Math.max(...pts.map((p) => p[1])),
      };
    }
  }
  const rb = internal.buses.get(id);
  if (rb) {
    const { at, span, axis } = rb.geometry;
    const half = span / 2;
    return axis === 'x'
      ? { minX: at[0] - half, maxX: at[0] + half, minY: at[1] - 2, maxY: at[1] + 2 }
      : { minX: at[0] - 2, maxX: at[0] + 2, minY: at[1] - half, maxY: at[1] + half };
  }
  const rj = internal.junctions.get(id);
  if (rj) return { minX: rj.world[0], maxX: rj.world[0], minY: rj.world[1], maxY: rj.world[1] };
  return null;
}

/** Where an issue's marker sits: the top-right corner of its target. */
export function markerPoint(internal: InternalModel, id: string): [number, number] | null {
  const b = targetBox(internal, id);
  if (!b) return null;
  if (internal.junctions.has(id)) return [b.maxX, b.minY];
  return [b.maxX + 2, b.minY - 2];
}

export function centerPoint(internal: InternalModel, id: string): [number, number] | null {
  const b = targetBox(internal, id);
  return b ? [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2] : null;
}
