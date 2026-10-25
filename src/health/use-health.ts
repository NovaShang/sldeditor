/**
 * The health report for the live document, computed once per compile.
 *
 * Several components read it (canvas markers, the checks panel, the badge
 * count), so it is cached on the compiled model's identity: every edit
 * produces a new `InternalModel`, every read between edits gets the same
 * report object — which also keeps zustand selectors stable.
 */

import { useEditorStore } from '../store';
import type { DiagramFile } from '../model';
import type { InternalModel } from '../compiler/internal-model';
import { checkHealth, type HealthReport } from './check';

const cache = new WeakMap<InternalModel, { diagram: DiagramFile; report: HealthReport }>();

export function healthFor(diagram: DiagramFile, internal: InternalModel): HealthReport {
  const hit = cache.get(internal);
  // Dismissals live in `meta` and change without a recompile of geometry in
  // principle; key on the diagram too so a dismissal is never stale.
  if (hit && hit.diagram === diagram) return hit.report;
  const report = checkHealth(diagram, internal);
  cache.set(internal, { diagram, report });
  return report;
}

export function useHealth(): HealthReport {
  return useEditorStore((s) => healthFor(s.diagram, s.internal));
}

/** Warnings and errors the user has not marked as intentional. */
export function openProblems(r: HealthReport) {
  return r.issues.filter((i) => i.severity !== 'info' && !i.dismissed);
}
