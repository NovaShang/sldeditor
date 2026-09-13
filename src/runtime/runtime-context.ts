/**
 * The "props channel" between `<OneLineViewer>` and the canvas layers.
 *
 * The layers keep rendering from the (private) editor store; live data does
 * not go through that store at all. Instead the viewer resolves its bindings
 * into a `RuntimeSnapshot` and publishes it here, and each layer reads the
 * entry for the element it is drawing to add `data-alarm` / `data-quality`,
 * skip a hidden symbol, or swap the label text. The editor never mounts a
 * provider, so it sees `EMPTY_RUNTIME` and renders exactly as before.
 */

import { createContext, useContext } from 'react';
import type { AlarmLevel } from '../model';
import type { ResolvedElementProps } from './bindings';

export interface RuntimeSnapshot {
  /** Resolved props keyed by element / bus id. */
  props: Record<string, ResolvedElementProps>;
  /** Display unit for an element's `value` readout, keyed by element id. */
  units: Record<string, string>;
}

export const EMPTY_RUNTIME: RuntimeSnapshot = { props: {}, units: {} };

export const RuntimeContext = createContext<RuntimeSnapshot>(EMPTY_RUNTIME);

export function useRuntime(): RuntimeSnapshot {
  return useContext(RuntimeContext);
}

const ALARM_RANK: Record<AlarmLevel, number> = { none: 0, warn: 1, alarm: 2, fault: 3 };

/** The more severe of two alarm levels (absent counts as `none`). */
export function maxAlarm(a?: AlarmLevel, b?: AlarmLevel): AlarmLevel {
  const x = a ?? 'none';
  const y = b ?? 'none';
  return ALARM_RANK[x] >= ALARM_RANK[y] ? x : y;
}

/** `data-alarm` attribute value: the level, or nothing for `none`. */
export function alarmAttr(p?: ResolvedElementProps): AlarmLevel | undefined {
  return p?.alarm && p.alarm !== 'none' ? p.alarm : undefined;
}

/** `data-quality` attribute value: only the two flagged states. */
export function qualityAttr(p?: ResolvedElementProps): 'bad' | 'stale' | undefined {
  return p?.quality === 'bad' || p?.quality === 'stale' ? p.quality : undefined;
}
