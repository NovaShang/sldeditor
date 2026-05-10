/**
 * Dispatch a synthetic `pointercancel` on the canvas host. Used by the
 * pinch-zoom hijack (useViewport) and the long-press → context-menu path
 * (CanvasSvg) to interrupt the active tool's in-progress gesture so it
 * runs its cancel cleanup instead of committing on the next pointerup.
 *
 * Best-effort: the `PointerEvent` constructor is missing on some older
 * touch browsers; failing silently is fine because the only downside is
 * the tool gesture lingering until the user lifts the finger naturally.
 */
export function dispatchSyntheticPointerCancel(
  host: EventTarget,
  pointerId: number,
): void {
  try {
    host.dispatchEvent(
      new PointerEvent('pointercancel', {
        pointerId,
        bubbles: true,
        cancelable: true,
        pointerType: 'touch',
      }),
    );
  } catch {
    /* PointerEvent constructor unsupported — leave the gesture to time out */
  }
}
