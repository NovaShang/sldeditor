/**
 * A one-line, self-dismissing notice shown above the bottom toolbar — the
 * editor's only "toast". For results the canvas does not show by itself
 * (e.g. "Numbered 12 potentials": the labels change, but how many were
 * numbered is not visible at a glance). Deliberately one slot: a new notice
 * replaces the old one instead of stacking.
 */

import { create } from 'zustand';

const NOTICE_MS = 2600;

interface NoticeState {
  text: string | null;
  show: (text: string) => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;

export const useNotice = create<NoticeState>((set) => ({
  text: null,
  show: (text) => {
    if (timer) clearTimeout(timer);
    set({ text });
    timer = setTimeout(() => {
      timer = null;
      set({ text: null });
    }, NOTICE_MS);
  },
}));
