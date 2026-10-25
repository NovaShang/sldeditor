/**
 * Turning a health issue into words and a place on the canvas. Shared by the
 * canvas markers and the checks panel so the two never disagree about where
 * an issue is or what it says.
 */

import type { InternalModel } from '../compiler/internal-model';
import { transformPoint } from '../compiler';
import type { LocaleKey } from '../i18n';
import type { HealthIssue } from './check';

type T = (key: LocaleKey, params?: Record<string, string | number>) => string;

/** Display name: the device's own name (first line), else its id. */
export function targetName(internal: InternalModel, id: string): string {
  const el = internal.elements.get(id)?.element;
  if (el) return (el.name ?? '').split(/\r\n|\r|\n/)[0].trim() || el.id;
  const bus = internal.buses.get(id)?.bus;
  if (bus) return bus.name?.trim() || bus.id;
  return id;
}

const fmt = (v: string | number | undefined) =>
  typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : (v ?? '');

export function issueText(t: T, internal: InternalModel, issue: HealthIssue): string {
  const d = issue.data ?? {};
  const params: Record<string, string | number> = {
    name: issue.targets[0] ? targetName(internal, issue.targets[0]) : '',
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
  const main = t(`health.code.${issue.code}` as LocaleKey, params);
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
