/**
 * Health-check markers and load figures on the canvas.
 *
 * A small dot at the top-right of every device, bus or junction a warning is
 * about (red for an error, amber for a warning). Notes get a quiet hollow dot
 * only while the checks panel is open, so the drawing is not peppered with
 * dots for things that are probably fine; the issue picked in the panel gets
 * a ring.
 * Transformers, UPSs and buses with load behind them get a short figure
 * ("320 kW · 64%"). Canvas only: none of this reaches an export.
 */

import { useEditorStore } from '../store';
import { usePanels } from '../hooks/use-panels';
import { useHostActions } from '../hooks/use-host-actions';
import { useT } from '../i18n';
import { useHealth } from '../health/use-health';
import { issueText, markerPoint, targetBox } from '../health/present';
import type { HealthIssue } from '../health';

/** Bound the marker count on pathological drawings (hundreds of broken
 *  joints): the panel still lists everything. */
const MAX_MARKERS = 300;
/** Rough advance of one character of the 9px figure, and the width of a
 *  device's name/params block beside it, in canvas units: enough to tell
 *  whether a figure would land on a neighbour. */
const FIGURE_CHAR_W = 5.2;
const LABEL_W = 45;

export function HealthLayer() {
  const on = usePanels((s) => s.healthMarkers);
  const readOnly = useEditorStore((s) => s.readOnly);
  const internal = useEditorStore((s) => s.internal);
  const report = useHealth();
  const panelOpen = usePanels((s) => s.healthOpen);
  const focus = usePanels((s) => s.healthFocus);
  const t = useT();
  if (!on || readOnly || !report.hasModel) return null;

  const markers: { key: string; at: [number, number]; severity: string; issueId: string; code: string; title: string }[] = [];
  for (const issue of report.issues) {
    if (issue.dismissed || (issue.severity === 'info' && !panelOpen)) continue;
    const title = issueText(t, internal, issue);
    for (const target of issue.targets.slice(0, 24)) {
      if (markers.length >= MAX_MARKERS) break;
      const at = markerPoint(internal, target);
      if (at) markers.push({ key: `${issue.id}|${target}`, at, severity: issue.severity, issueId: issue.id, code: issue.code, title });
    }
  }

  const figures = report.loads.flatMap((l) => {
    // Nothing rated yet: a "0 kW" on the drawing would read as a result.
    // The panel still says how many loads are missing a rating.
    if (l.known === 0) return [];
    const box = targetBox(internal, l.targetId);
    if (!box) return [];
    const kw = Math.round(l.knownKW);
    const pct = l.loadingPct === undefined ? '' : ` · ${Math.round(l.loadingPct)}%`;
    const partial = l.known < l.total ? ` · ${t('health.figurePartial', { k: l.known, t: l.total })}` : '';
    const isBus = internal.buses.has(l.targetId) || internal.elements.get(l.targetId)?.element.kind === 'busbar';
    const text = `Σ ${kw} kW${pct}${partial}`;
    const over = (l.loadingPct ?? 0) > 100;
    // Buses: above the left end.
    if (isBus) return [{ key: l.targetId, at: [box.minX, box.minY - 5] as [number, number], anchor: 'start' as const, text, over }];
    // Devices: left of the symbol, clear of the name/params block, which sits
    // on the right — unless a neighbour is there (two transformers side by
    // side: the figure landed on the first one's labels). Then below it.
    const midY = (box.minY + box.maxY) / 2;
    const w = text.length * FIGURE_CHAR_W;
    const left = { minX: box.minX - 4 - w, maxX: box.minX - 4, minY: midY - 8, maxY: midY + 3 };
    const blocked = [...internal.elements.keys()].some((id) => {
      if (id === l.targetId) return false;
      const b = targetBox(internal, id);
      // Count the neighbour's own label block, to its right.
      return !!b && b.minX < left.maxX && b.maxX + LABEL_W > left.minX && b.minY < left.maxY && b.maxY > left.minY;
    });
    const at: [number, number] = blocked ? [box.maxX + 2, box.maxY + 9] : [box.minX - 4, midY];
    return [{ key: l.targetId, at, anchor: (blocked ? 'start' : 'end') as 'start' | 'end', text, over }];
  });

  const focused: HealthIssue | undefined = focus ? report.issues.find((i) => i.id === focus) : undefined;
  const rings = (focused?.targets ?? []).slice(0, 24).flatMap((id) => {
    const b = targetBox(internal, id);
    if (!b) return [];
    const pad = 6;
    return [{ key: id, x: b.minX - pad, y: b.minY - pad, w: b.maxX - b.minX + pad * 2, h: b.maxY - b.minY + pad * 2 }];
  });

  const open = (issueId: string, code: string, target: string) => {
    const st = useEditorStore.getState();
    if (st.internal.elements.has(target) || st.internal.buses.has(target) || st.internal.junctions.has(target)) {
      st.setSelection([target]);
    }
    usePanels.getState().setHealthOpen(true, issueId);
    useHostActions.getState().onHealthEvent?.({ type: 'open', issueId, code });
  };

  return (
    <g className="ole-health-layer" pointerEvents="none">
      {rings.map((r) => (
        <rect key={`${focus}|${r.key}`} className="ole-health-focus" x={r.x} y={r.y} width={r.w} height={r.h} rx={4} />
      ))}
      {figures.map((f) => (
        <text
          key={f.key}
          className="ole-health-figure"
          data-over={f.over ? 'true' : undefined}
          x={f.at[0]}
          y={f.at[1]}
          textAnchor={f.anchor}
        >
          {f.text}
        </text>
      ))}
      {markers.map((m) => (
        <g
          key={m.key}
          className={m.severity === 'info' ? 'ole-health-marker ole-health-note' : 'ole-health-marker'}
          data-severity={m.severity}
          transform={`translate(${m.at[0]} ${m.at[1]})`}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            open(m.issueId, m.code, m.key.split('|')[1]);
          }}
        >
          <title>{m.title}</title>
          <circle r={m.severity === 'info' ? 3.5 : 5} />
          {m.severity !== 'info' && <text y={2.6} textAnchor="middle">!</text>}
        </g>
      ))}
    </g>
  );
}
