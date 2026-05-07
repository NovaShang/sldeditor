/**
 * Module-level singleton for the active viewport API. `CanvasSvg` registers
 * itself on mount; chrome (e.g. `ViewToolbar`) reads via `getViewportApi()`
 * and calls imperatively. Pairs with `zoom-bus` (which carries reactive
 * scale notifications) — this one is for command dispatch, not subscription.
 */

import type { ViewportApi } from './useViewport';

let current: ViewportApi | null = null;

export function setViewportApi(api: ViewportApi | null): void {
  current = api;
}

export function getViewportApi(): ViewportApi | null {
  return current;
}
