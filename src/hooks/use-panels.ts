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
}

interface PanelState {
  outlineOpen: boolean;
  setOutlineOpen: (open: boolean) => void;
  toggleOutline: () => void;
}

function readInitial(): Pick<PanelState, 'outlineOpen'> {
  if (typeof window === 'undefined') return { outlineOpen: false };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { outlineOpen: false };
    const obj = JSON.parse(raw) as unknown;
    if (typeof obj !== 'object' || obj === null) return { outlineOpen: false };
    const o = obj as Record<string, unknown>;
    return { outlineOpen: o.outline === true };
  } catch {
    return { outlineOpen: false };
  }
}

function persist(s: { outlineOpen: boolean }): void {
  try {
    const data: Persisted = { outline: s.outlineOpen };
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
}));
