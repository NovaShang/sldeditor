/**
 * Wires the active tool's pointer/key handlers onto the canvas host. Re-runs
 * on tool change to call `onDeactivate` for the old and `onActivate` for the
 * new — that's where tools install/remove their per-mode state (e.g. WireTool
 * adding `.tool-wire` to reveal terminals).
 */

import { useEffect, type RefObject } from 'react';
import { useEditorStore } from '../store';
import { TOOLS } from './tools';
import type { ToolContext } from './tools';
import type { ViewportApi } from './useViewport';

export function useTools(
  hostRef: RefObject<HTMLDivElement | null>,
  viewport: ViewportApi,
): void {
  const activeTool = useEditorStore((s) => s.activeTool);
  const readOnly = useEditorStore((s) => s.readOnly);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // In read-only mode only the pan tool is ever attached, regardless of the
    // (possibly persisted) activeTool — this is the single choke point that
    // keeps Select/Wire/Place/Bus/Junction/Text off the canvas.
    const toolId = readOnly ? 'pan' : activeTool;
    const tool = readOnly ? TOOLS.pan : TOOLS[activeTool];
    const ctx: ToolContext = { viewport, hostEl: host };

    // Reflect the active tool as a data attribute so CSS can style by mode
    // (e.g. reveal every junction dot while a drawing/placing tool is active).
    host.dataset.tool = toolId;

    tool.onActivate?.(ctx);
    if (tool.cursor) host.style.cursor = tool.cursor;

    const onDown = (e: PointerEvent) => tool.onPointerDown?.(e, ctx);
    const onMove = (e: PointerEvent) => tool.onPointerMove?.(e, ctx);
    const onUp = (e: PointerEvent) => tool.onPointerUp?.(e, ctx);
    // Pointercancel: if the tool defines its own cancel hook, use it (so it
    // can roll back without committing the gesture). Otherwise treat it as
    // a normal pointerup — the existing tools already handle that case.
    const onCancel = (e: PointerEvent) =>
      tool.onPointerCancel ? tool.onPointerCancel(e, ctx) : tool.onPointerUp?.(e, ctx);
    const onLeave = (e: PointerEvent) => tool.onPointerLeave?.(e, ctx);
    const onDbl = (e: MouseEvent) => tool.onDoubleClick?.(e, ctx);

    host.addEventListener('pointerdown', onDown);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerup', onUp);
    host.addEventListener('pointercancel', onCancel);
    host.addEventListener('pointerleave', onLeave);
    host.addEventListener('dblclick', onDbl);

    return () => {
      host.removeEventListener('pointerdown', onDown);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerup', onUp);
      host.removeEventListener('pointercancel', onCancel);
      host.removeEventListener('pointerleave', onLeave);
      host.removeEventListener('dblclick', onDbl);
      tool.onDeactivate?.(ctx);
      host.style.cursor = '';
      delete host.dataset.tool;
    };
  }, [activeTool, readOnly, hostRef, viewport]);
}
