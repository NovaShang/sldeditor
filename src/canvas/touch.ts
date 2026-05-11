/**
 * Phone-class UX helpers shared by the drawing tools (place / wire / busbar /
 * text). On a narrow coarse-pointer viewport the user expects a "one-shot"
 * gesture: pick a tool, place / wire / etc. once, and snap back to the
 * default pan tool. Desktop and tablet keep the sticky-tool behavior since
 * the keyboard / stylus makes re-entry cheap and multi-place is common.
 *
 * The viewport-width gate keeps tablet (iPad ≈ 768px portrait, also a
 * coarse pointer) on the desktop-style flow — the unified bottom bar /
 * full-screen library are only the phone form factor.
 */

import { useEditorStore } from '../store';
import { BREAKPOINTS } from '../hooks/editor-tier';

function isPhoneUx(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (!window.matchMedia('(pointer: coarse)').matches) return false;
  } catch {
    return false;
  }
  return window.innerWidth < BREAKPOINTS.dense;
}

export function exitToPanOnPhone(): void {
  if (!isPhoneUx()) return;
  useEditorStore.getState().setActiveTool('pan');
}

/**
 * On a phone-class viewport, drop the currently armed place kind without
 * leaving place mode. PlaceTool calls this after each successful placement
 * so the LibraryPopover (hidden while armed on mobile) reappears for the
 * next pick. Sticky `lastPlaceKind` is preserved by `setPlaceKind(null)`.
 */
export function disarmPlaceOnPhone(): void {
  if (!isPhoneUx()) return;
  useEditorStore.getState().setPlaceKind(null);
}
