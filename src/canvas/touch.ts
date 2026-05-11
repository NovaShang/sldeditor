/**
 * Touch-mode helpers shared by the drawing tools (place / wire / busbar /
 * text). On a coarse-pointer device the user expects a "one-shot" gesture:
 * pick a tool, place / wire / etc. once, and snap back to the default pan
 * tool instead of staying armed for another commit. Desktop keeps the
 * sticky-tool behavior since the keyboard makes re-entry cheap.
 */

import { useEditorStore } from '../store';

function isCoarsePointer(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export function exitToPanIfTouch(): void {
  if (!isCoarsePointer()) return;
  useEditorStore.getState().setActiveTool('pan');
}
