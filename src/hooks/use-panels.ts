/**
 * Tiny Zustand store for cross-component panel open/closed state.
 *
 * The outline panel toggle lives at bottom-left and persists across reloads.
 * The library popover is no longer tracked here — it follows the editor's
 * active tool (`activeTool === 'place'`) so the toolbar button behaves like
 * any other mutually-exclusive tool.
 */

import { create } from 'zustand';

const STORAGE_KEY = 'ole-panel-open';

interface Persisted {
  outline: boolean;
  /** Health-check markers on the canvas. Absent = on (the default). */
  health?: boolean;
}

interface PanelState {
  outlineOpen: boolean;
  setOutlineOpen: (open: boolean) => void;
  toggleOutline: () => void;
  /** Show health-check markers and load figures on the canvas. Default on:
   *  the check is the point of the feature, and it can be switched off. */
  healthMarkers: boolean;
  setHealthMarkers: (on: boolean) => void;
  /** Checks panel open, and the issue it should scroll to (a marker click). */
  healthOpen: boolean;
  healthFocus: string | null;
  setHealthOpen: (open: boolean, focus?: string | null) => void;
}

function readInitial(): Pick<PanelState, 'outlineOpen' | 'healthMarkers'> {
  const fallback = { outlineOpen: false, healthMarkers: true };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const obj = JSON.parse(raw) as unknown;
    if (typeof obj !== 'object' || obj === null) return fallback;
    const o = obj as Record<string, unknown>;
    return { outlineOpen: o.outline === true, healthMarkers: o.health !== false };
  } catch {
    return fallback;
  }
}

function persist(s: { outlineOpen: boolean; healthMarkers: boolean }): void {
  try {
    const data: Persisted = { outline: s.outlineOpen, ...(s.healthMarkers ? {} : { health: false }) };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore quota / disabled storage
  }
}

export const usePanels = create<PanelState>((set, get) => ({
  ...readInitial(),
  setOutlineOpen: (outlineOpen) => {
    set({ outlineOpen });
    persist(get());
  },
  toggleOutline: () => {
    set((s) => ({ outlineOpen: !s.outlineOpen }));
    persist(get());
  },
  setHealthMarkers: (healthMarkers) => {
    set({ healthMarkers });
    persist(get());
  },
  healthOpen: false,
  healthFocus: null,
  setHealthOpen: (healthOpen, focus = null) => set({ healthOpen, healthFocus: focus }),
}));
