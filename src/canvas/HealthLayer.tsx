/**
 * Health-check markers and load figures on the canvas.
 *
 * A small dot at the top-right of every device, bus or junction a warning is
 * about (red for an error, amber for a warning); notes stay in the panel so
 * the drawing is not peppered with dots for things that are probably fine.
 * Transformers, UPSs and buses with load behind them get a short figure
 * ("320 kW · 64%"). Canvas only: none of this reaches an export.
 */

import { useEditorStore } from '../store';
import { usePanels } from '../hooks/use-panels';
import { useHostActions } from '../hooks/use-host-actions';
import { useT } from '../i18n';
import { useHealth } from '../health/use-health';
import { issueText, markerPoint, targetBox } from '../health/present';

/** Bound the marker count on pathological drawings (hundreds of broken
 *  joints): the panel still lists everything. */
const MAX_MARKERS = 300;

export function HealthLayer() {
  const on = usePanels((s) => s.healthMarkers);
  const readOnly = useEditorStore((s) => s.readOnly);
  const internal = useEditorStore((s) => s.internal);
  const report = useHealth();
  const t = useT();
  if (!on || readOnly || !report.hasModel) return null;

  const markers: { key: string; at: [number, number]; severity: string; issueId: string; code: string; title: string }[] = [];
  for (const issue of report.issues) {
    if (issue.severity === 'info' || issue.dismissed) continue;
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
    const partial = l.known < l.total ? ` (${l.known}/${l.total})` : '';
    const isBus = internal.buses.has(l.targetId) || internal.elements.get(l.targetId)?.element.kind === 'busbar';
    // Buses: above the left end. Devices: left of the symbol, clear of the
    // name/params block, which sits on the right.
    const at: [number, number] = isBus ? [box.minX, box.minY - 5] : [box.minX - 4, (box.minY + box.maxY) / 2];
    const over = (l.loadingPct ?? 0) > 100;
    return [{ key: l.targetId, at, anchor: (isBus ? 'start' : 'end') as 'start' | 'end', text: `Σ ${kw} kW${pct}${partial}`, over }];
  });

  const open = (issueId: string, code: string, target: string) => {
    const st = useEditorStore.getState();
    if (st.internal.elements.has(target) || st.internal.buses.has(target)) st.setSelection([target]);
    usePanels.getState().setHealthOpen(true, issueId);
    useHostActions.getState().onHealthEvent?.({ type: 'open', issueId, code });
  };

  return (
    <g className="ole-health-layer" pointerEvents="none">
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
          className="ole-health-marker"
          data-severity={m.severity}
          transform={`translate(${m.at[0]} ${m.at[1]})`}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            open(m.issueId, m.code, m.key.split('|')[1]);
          }}
        >
          <title>{m.title}</title>
          <circle r={5} />
          <text y={2.6} textAnchor="middle">!</text>
        </g>
      ))}
    </g>
  );
}
