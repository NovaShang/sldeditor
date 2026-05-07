/**
 * Tool registry: every canvas interaction implements `Tool`. The `useTools`
 * hook attaches the active tool's handlers to the canvas host and routes
 * pointer/key events through it.
 *
 * Tools are pure event handlers — they read/write the store via the live
 * `ctx.store.getState()` snapshot rather than capturing closures. This way
 * a tool definition can stay stateless (any per-gesture state lives in
 * module-level refs inside the tool file).
 */

import type { ToolId } from '../../store';
import type { ViewportApi } from '../useViewport';

export type { ToolId } from '../../store';

export interface ToolContext {
  viewport: ViewportApi;
  hostEl: HTMLElement;
}

export interface Tool {
  id: ToolId;
  cursor?: string;
  onActivate?(ctx: ToolContext): void;
  onDeactivate?(ctx: ToolContext): void;
  onPointerDown?(e: PointerEvent, ctx: ToolContext): void;
  onPointerMove?(e: PointerEvent, ctx: ToolContext): void;
  onPointerUp?(e: PointerEvent, ctx: ToolContext): void;
  onPointerLeave?(e: PointerEvent, ctx: ToolContext): void;
}
