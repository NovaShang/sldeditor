/**
 * One-shot onboarding-card dismissal flag, persisted to localStorage.
 *
 * Mirrors `usePanels` / `useTheme` patterns: a tiny Zustand store with a
 * boolean and a setter. Once dismissed, the card stays hidden across
 * reloads; clearing storage (or calling `reset`) brings it back.
 */

import { create } from 'zustand';

const STORAGE_KEY = 'ole-onboarding-dismissed';

function readInitial(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persist(dismissed: boolean): void {
  try {
    if (dismissed) window.localStorage.setItem(STORAGE_KEY, '1');
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore quota / disabled storage
  }
}

interface OnboardingState {
  dismissed: boolean;
  dismiss: () => void;
  /**
   * Hide the card for this page load only, without remembering it: for a
   * host that opens the editor with a purpose of its own (a ready-made
   * example from a landing page), where "place a component" is beside the
   * point — but a later blank visit should still get the card.
   */
  hide: () => void;
  reset: () => void;
}

export const useOnboarding = create<OnboardingState>((set) => ({
  dismissed: readInitial(),
  dismiss: () => {
    persist(true);
    set({ dismissed: true });
  },
  hide: () => set({ dismissed: true }),
  reset: () => {
    persist(false);
    set({ dismissed: false });
  },
}));
