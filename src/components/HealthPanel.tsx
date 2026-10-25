/**
 * The checks panel: every health issue in one list, the load totals, and the
 * "this is intentional" escape hatch. Opened from the view toolbar (badge =
 * open problems) or by clicking a marker on the canvas.
 */

import { useEffect, useRef, useState } from 'react';
import { Stethoscope } from 'lucide-react';
import { Button } from './ui/button';
import { Tooltip } from './ui/tooltip';
import { UpwardPopover } from './ui/upward-popover';
import { useEditorStore } from '../store';
import { usePanels } from '../hooks/use-panels';
import { useHostActions } from '../hooks/use-host-actions';
import { useT, type LocaleKey } from '../i18n';
import { cn } from '../lib/utils';
import { openProblems, useHealth } from '../health/use-health';
import { centerPoint, issueText, targetName } from '../health/present';
import { centerOnWorld } from '../canvas/fit-to-content';
import type { HealthIssue } from '../health';

/** Set once the first-run explanation has been shown; it never shows again. */
const INTRO_KEY = 'ole-health-intro-seen';
const INTRO_AUTO_HIDE_MS = 15000;

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
  const open = usePanels((s) => s.healthOpen);
  const setOpen = usePanels((s) => s.setHealthOpen);
  const count = openProblems(report).length;
  const anchorRef = useRef<HTMLDivElement>(null);
  const [intro, setIntro] = useState(false);

  // The first time a drawing shows problems, say once — quietly — what the
  // dots are. Only when the button is actually on screen (a host may hide it,
  // e.g. inside a marketing demo), so "seen" is never spent invisibly.
  useEffect(() => {
    if (count === 0 || intro || introSeen()) return;
    const btn = anchorRef.current?.querySelector<HTMLElement>('.ole-health-btn');
    if (!btn || btn.offsetParent === null) return;
    markIntroSeen();
    setIntro(true);
  }, [count, intro]);
  useEffect(() => {
    if (!intro) return;
    const timer = setTimeout(() => setIntro(false), INTRO_AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [intro]);

  return (
    <div ref={anchorRef} className="relative">
      {intro && !open && (
        <div
          role="status"
          className="ole-glass ole-health-intro absolute bottom-full end-0 mb-2 w-64 rounded-xl border border-border p-3 text-xs shadow-md"
        >
          <div className="text-[12px] font-medium">{t('health.introTitle')}</div>
          <p className="mt-1 leading-snug text-muted-foreground">{t('health.intro', { n: count })}</p>
          <div className="mt-2 flex justify-end gap-1.5">
            <button
              type="button"
              className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => setIntro(false)}
            >
              {t('health.introOk')}
            </button>
            <button
              type="button"
              className="rounded-md bg-primary px-2 py-1 text-[11px] text-primary-foreground hover:opacity-90"
              onClick={() => {
                setIntro(false);
                setOpen(true);
              }}
            >
              {t('health.introShow')}
            </button>
          </div>
        </div>
      )}
      <HealthMenuPopover open={open} setOpen={setOpen} count={count} />
    </div>
  );
}

function HealthMenuPopover({
  open,
  setOpen,
  count,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  count: number;
}) {
  const t = useT();
  return (
    <UpwardPopover
      open={open}
      onOpenChange={(v) => setOpen(v)}
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
      <HealthControls />
    </UpwardPopover>
  );
}

export function HealthControls() {
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
    if (st.internal.elements.has(target) || st.internal.buses.has(target)) st.setSelection([target]);
    const at = centerPoint(st.internal, target);
    if (at) centerOnWorld(at);
    useHostActions.getState().onHealthEvent?.({ type: 'open', issueId: issue.id, code: issue.code });
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
    <div className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-1 text-xs">
      <div className="flex items-center justify-between gap-2 px-2 pb-1">
        <span className="text-[12px] font-medium">{t('health.title')}</span>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
          <input type="checkbox" checked={markers} onChange={(e) => setMarkers(e.target.checked)} />
          {t('health.markers')}
        </label>
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
              <div key={l.targetId} className="flex items-baseline justify-between gap-2 px-2 py-0.5 text-[11px]">
                <span className="min-w-0 truncate">{targetName(internal, l.targetId)}</span>
                <span className="shrink-0 text-right text-muted-foreground">
                  {l.known === l.total
                    ? t('health.loadAll', { kw: Math.round(l.knownKW), t: l.total })
                    : t('health.loadKnown', { kw: Math.round(l.knownKW), k: l.known, t: l.total })}
                  {l.loadingPct !== undefined && (
                    <>
                      {' · '}
                      <span className={cn((l.loadingPct ?? 0) > 100 && 'text-amber-600')}>
                        {t('health.loading', { pct: Math.round(l.loadingPct), rating: Math.round(l.ratingKVA ?? 0) })}
                      </span>
                    </>
                  )}
                </span>
              </div>
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
