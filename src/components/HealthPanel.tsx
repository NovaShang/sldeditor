/**
 * The checks panel: every health issue in one list, the load totals, and the
 * "this is intentional" escape hatch. Opened from the view toolbar (badge =
 * open problems) or by clicking a marker on the canvas.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Stethoscope, X } from 'lucide-react';
import { Button } from './ui/button';
import { Tooltip } from './ui/tooltip';
import { UpwardPopover } from './ui/upward-popover';
import { useEditorStore } from '../store';
import { usePanels } from '../hooks/use-panels';
import { useOnboarding } from '../hooks/use-onboarding';
import { useHostActions } from '../hooks/use-host-actions';
import { useT, type LocaleKey } from '../i18n';
import { cn } from '../lib/utils';
import { openProblems, useHealth } from '../health/use-health';
import { centerPoint, issueText, targetName } from '../health/present';
import { centerOnWorld } from '../canvas/fit-to-content';
import type { HealthIssue, LoadSummary } from '../health';
import type { InternalModel } from '../compiler/internal-model';

/** Set once the user has acknowledged the first-run explanation (Got it /
 *  Show / opening the panel): until then it may come back on a later visit. */
const INTRO_KEY = 'ole-health-intro-seen';
/** How long the drawing must sit unchanged before the explanation appears:
 *  the 10-25 walkthrough saw it pop up mid-wire, about a breaker that was
 *  unwired only because the user had not finished drawing yet. */
const INTRO_IDLE_MS = 4000;

function introSeen(): boolean {
  try {
    return window.localStorage.getItem(INTRO_KEY) === '1';
  } catch {
    return true; // no storage: never nag
  }
}
function markIntroSeen(): void {
  try {
    window.localStorage.setItem(INTRO_KEY, '1');
  } catch {
    // ignore
  }
}

export function HealthMenuBtn() {
  const t = useT();
  const report = useHealth();
  const internal = useEditorStore((s) => s.internal);
  const open = usePanels((s) => s.healthOpen);
  const setOpen = usePanels((s) => s.setHealthOpen);
  const onboarding = !useOnboarding((s) => s.dismissed);
  const count = openProblems(report).length;
  const anchorRef = useRef<HTMLDivElement>(null);
  const [intro, setIntro] = useState(false);
  // Something worth checking: a wire, or a handful of symbols. A lone symbol
  // just dropped on the canvas is "unwired" only because drawing has begun.
  const drawn = internal.wireRenders.size > 0 || internal.elements.size >= 4;

  // The first time a drawing shows problems, explain once what the dots
  // are — after the user pauses, never while the quick-start card is up, and
  // only when the button is actually on screen (a host may hide it, e.g. in
  // a marketing demo). Every edit restarts the wait.
  useEffect(() => {
    if (intro || open || onboarding || count === 0 || !drawn || introSeen()) return;
    const timer = setTimeout(() => {
      const btn = anchorRef.current?.querySelector<HTMLElement>('.ole-health-btn');
      if (btn && btn.offsetParent !== null) setIntro(true);
    }, INTRO_IDLE_MS);
    return () => clearTimeout(timer);
  }, [internal, count, drawn, intro, open, onboarding]);
  // Problems all fixed before the user read it: nothing left to explain.
  useEffect(() => {
    if (intro && count === 0) setIntro(false);
  }, [intro, count]);

  const ack = (show: boolean) => {
    markIntroSeen();
    setIntro(false);
    if (show) setOpen(true);
  };

  return (
    <div ref={anchorRef} className="relative">
      {intro && !open && (
        <div
          role="status"
          className="ole-glass ole-health-intro ole-health-panel absolute bottom-full end-0 mb-2 w-64 rounded-xl border border-border p-3 text-xs shadow-md"
        >
          <div className="text-[12px] font-medium">{t('health.title')}</div>
          <p className="mt-1 leading-snug text-muted-foreground">{t('health.intro', { n: count })}</p>
          <div className="mt-2 flex justify-end gap-1.5">
            <button
              type="button"
              className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => ack(false)}
            >
              {t('health.introOk')}
            </button>
            <button
              type="button"
              className="rounded-md bg-primary px-2 py-1 text-[11px] text-primary-foreground hover:opacity-90"
              onClick={() => ack(true)}
            >
              {t('health.introShow')}
            </button>
          </div>
        </div>
      )}
      <HealthMenuPopover
        anchorRef={anchorRef}
        open={open}
        setOpen={(v) => {
          if (v && intro) ack(false);
          setOpen(v);
        }}
        count={count}
      />
    </div>
  );
}

/** Width of the checks panel (w-80) plus the gap kept from the properties. */
const PANEL_W = 320;
const GAP = 8;

function HealthMenuPopover({
  anchorRef,
  open,
  setOpen,
  count,
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  open: boolean;
  setOpen: (v: boolean) => void;
  count: number;
}) {
  const t = useT();
  // The panel stays open while the user edits, and the properties panel
  // (selection) sits right above it on the same edge: slide left of it rather
  // than cover the fields the user is about to type in. Where there is no
  // room (narrow windows) it stays put.
  const selection = useEditorStore((s) => s.selection);
  const selectedAnnotations = useEditorStore((s) => s.selectedAnnotations);
  const selectedWire = useEditorStore((s) => s.selectedWire);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const props = document.querySelector('.ole-right-panel')?.getBoundingClientRect();
      if (!anchor || !props || props.width === 0) return setShift(0);
      const need = anchor.right - (props.left - GAP);
      setShift(need > 0 && props.left - GAP - PANEL_W > GAP ? need : 0);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, anchorRef, selection, selectedAnnotations, selectedWire]);
  return (
    <UpwardPopover
      open={open}
      onOpenChange={(v) => setOpen(v)}
      // Stays open while the user fixes what it lists: clicking the canvas or
      // a property field used to close it (10-25 walkthrough).
      persistent
      className="ole-health-panel"
      style={shift ? { right: shift } : undefined}
      trigger={
        <Tooltip
          content={
            <div className="space-y-0.5">
              <div className="font-medium">{t('health.title')}</div>
              <div className="text-muted-foreground">{t('health.hint')}</div>
            </div>
          }
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen(!open)}
            aria-label={t('health.title')}
            aria-expanded={open}
            className="ole-health-btn relative"
          >
            <Stethoscope />
            {count > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-semibold leading-none text-white">
                {count > 99 ? '99+' : count}
              </span>
            )}
          </Button>
        </Tooltip>
      }
    >
      <HealthControls onClose={() => setOpen(false)} />
    </UpwardPopover>
  );
}

/** "380 kW · 422 kVA · 609 A": current only where the voltage is known. */
function loadFigures(internal: InternalModel, l: LoadSummary): string {
  const parts = [`${Math.round(l.knownKW)} kW`, `${Math.round(l.knownKVA)} kVA`];
  const un = busVoltage(internal, l.targetId);
  if (un) parts.push(`${Math.round(l.knownKVA / (Math.sqrt(3) * un))} A`);
  return parts.join(' · ');
}

/** Line voltage (kV) at a bus or busbar element, when it says. */
function busVoltage(internal: InternalModel, id: string): number | undefined {
  const params = internal.buses.get(id)?.bus.params ?? internal.elements.get(id)?.element.params;
  const un = params?.Un;
  return typeof un === 'number' && un > 0 ? un : undefined;
}

export function HealthControls({ onClose }: { onClose?: () => void } = {}) {
  const t = useT();
  const report = useHealth();
  const internal = useEditorStore((s) => s.internal);
  const markers = usePanels((s) => s.healthMarkers);
  const setMarkers = usePanels((s) => s.setHealthMarkers);
  const focus = usePanels((s) => s.healthFocus);
  const listRef = useRef<HTMLDivElement>(null);

  const problems = openProblems(report);
  const notes = report.issues.filter((i) => i.severity === 'info' && !i.dismissed);
  const dismissed = report.issues.filter((i) => i.dismissed);

  useEffect(() => {
    if (!focus) return;
    listRef.current
      ?.querySelector(`[data-issue="${CSS.escape(focus)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [focus]);

  const go = (issue: HealthIssue) => {
    const target = issue.targets[0];
    if (!target) return;
    const st = useEditorStore.getState();
    if (st.internal.elements.has(target) || st.internal.buses.has(target) || st.internal.junctions.has(target)) {
      st.setSelection([target]);
    }
    usePanels.getState().setHealthOpen(true, issue.id);
    const at = centerPoint(st.internal, target);
    if (at) centerOnWorld(at);
    useHostActions.getState().onHealthEvent?.({ type: 'open', issueId: issue.id, code: issue.code });
  };
  const locate = (id: string) => {
    const st = useEditorStore.getState();
    if (st.internal.elements.has(id) || st.internal.buses.has(id)) st.setSelection([id]);
    const at = centerPoint(st.internal, id);
    if (at) centerOnWorld(at);
  };
  /** Join a wire end to the point it visibly sits on: one undo step. */
  const connect = (issue: HealthIssue, target: string) => {
    useEditorStore.getState().mergeJunctionInto(issue.targets[0], target);
    useHostActions.getState().onHealthEvent?.({ type: 'fix', issueId: issue.id, code: issue.code });
  };
  const setDismissed = (issue: HealthIssue, d: boolean) => {
    useEditorStore.getState().setHealthDismissed(issue.id, d);
    useHostActions.getState().onHealthEvent?.({ type: d ? 'dismiss' : 'restore', issueId: issue.id, code: issue.code });
  };

  const row = (issue: HealthIssue, action: 'dismiss' | 'restore' | null) => (
    <div
      key={issue.id}
      data-issue={issue.id}
      className={cn(
        'group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent',
        focus === issue.id && 'bg-accent',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-1 size-2 shrink-0 rounded-full',
          issue.severity === 'error' ? 'bg-red-600' : issue.severity === 'warning' ? 'bg-amber-500' : 'bg-muted-foreground/50',
        )}
      />
      <button
        type="button"
        onClick={() => go(issue)}
        className="min-w-0 flex-1 text-left text-[11px] leading-snug text-foreground"
      >
        {issueText(t, internal, issue)}
      </button>
      {action === 'dismiss' && issue.code === 'looks-joined' && typeof issue.data?.joins === 'string' && (
        <button
          type="button"
          onClick={() => connect(issue, issue.data!.joins as string)}
          className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground hover:opacity-90"
        >
          {t('health.connect')}
        </button>
      )}
      {action && (
        <button
          type="button"
          onClick={() => setDismissed(issue, action === 'dismiss')}
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-background hover:text-foreground"
        >
          {action === 'dismiss' ? t('health.dismiss') : t('health.restore')}
        </button>
      )}
    </div>
  );

  /**
   * One row per issue, but issues of the same kind fold under one header
   * ("Not connected ×20") once there are two or more: a drawing whose wires
   * all stop short of their terminals would otherwise bury everything else.
   * The group holding the focused issue (a marker click) opens itself.
   */
  const grouped = (list: HealthIssue[], action: 'dismiss' | 'restore') => {
    const byCode = new Map<string, HealthIssue[]>();
    for (const i of list) byCode.set(i.code, [...(byCode.get(i.code) ?? []), i]);
    return [...byCode].map(([code, items]) =>
      items.length === 1 ? (
        row(items[0], action)
      ) : (
        <details key={code} open={items.some((i) => i.id === focus) || undefined}>
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
            <span
              aria-hidden
              className={cn(
                'size-2 shrink-0 rounded-full',
                items[0].severity === 'error' ? 'bg-red-600' : items[0].severity === 'warning' ? 'bg-amber-500' : 'bg-muted-foreground/50',
              )}
            />
            <span className="min-w-0 flex-1 text-[11px] font-medium text-foreground">
              {t(`health.label.${code}` as LocaleKey)}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">×{items.length}</span>
          </summary>
          <div className="ms-3 border-s border-border/60 ps-1">{items.map((i) => row(i, action))}</div>
        </details>
      ),
    );
  };

  return (
    <div data-ole-occludes="" className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-1 text-xs">
      <div className="flex items-center justify-between gap-2 ps-2 pb-1">
        <span className="text-[12px] font-medium">{t('health.title')}</span>
        <span className="flex items-center gap-1">
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
            <input type="checkbox" checked={markers} onChange={(e) => setMarkers(e.target.checked)} />
            {t('health.markers')}
          </label>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </span>
      </div>
      <div ref={listRef} className="flex max-h-[55vh] flex-col gap-1 overflow-y-auto">
        {problems.length === 0 ? (
          <div className="px-2 py-1.5 text-[11px] text-muted-foreground">{t('health.none')}</div>
        ) : (
          <>
            <div className="px-2 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('health.sectionProblems')} · {problems.length}
            </div>
            {grouped(problems, 'dismiss')}
          </>
        )}
        {report.loads.length > 0 && (
          <>
            <div className="px-2 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('health.sectionLoads')}
            </div>
            {report.loads.map((l) => (
              <button
                type="button"
                key={l.targetId}
                onClick={() => locate(l.targetId)}
                className="flex flex-col gap-0.5 rounded-md px-2 py-1 text-left text-[11px] hover:bg-accent"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">{targetName(internal, l.targetId, t)}</span>
                  {l.known > 0 && l.loadingPct !== undefined && (
                    <span className={cn('shrink-0 tabular-nums', l.loadingPct > 100 ? 'text-amber-600' : 'text-muted-foreground')}>
                      {t('health.loading', { pct: Math.round(l.loadingPct), rating: Math.round(l.ratingKVA ?? 0) })}
                    </span>
                  )}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {l.known === 0
                    ? t('health.loadNone', { t: l.total })
                    : `${loadFigures(internal, l)} · ${
                        l.known === l.total
                          ? t('health.loadAll', { t: l.total })
                          : t('health.loadKnown', { k: l.known, t: l.total })
                      }`}
                </span>
                {l.parallelWith && l.parallelWith.length > 0 && (
                  <span className="text-muted-foreground">
                    {t('health.parallel', { names: l.parallelWith.map((id) => targetName(internal, id, t)).join(', ') })}
                  </span>
                )}
              </button>
            ))}
          </>
        )}
        {notes.length > 0 && (
          <details className="px-0">
            <summary className="cursor-pointer px-2 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('health.sectionNotes')} · {notes.length}
            </summary>
            {grouped(notes, 'dismiss')}
          </details>
        )}
        {dismissed.length > 0 && (
          <details>
            <summary className="cursor-pointer px-2 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('health.sectionDismissed')} · {dismissed.length}
            </summary>
            {grouped(dismissed, 'restore')}
          </details>
        )}
      </div>
      <div className="border-t border-border/60 px-2 pt-1.5 text-[10px] leading-snug text-muted-foreground">
        {t('health.disclaimer')}
      </div>
    </div>
  );
}
