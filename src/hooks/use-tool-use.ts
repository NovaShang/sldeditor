/**
 * Report drawing-tool activations to the host (`OneLineEditorProps.onToolUse`).
 *
 * The editor's own edits are invisible to a host's analytics: it sees the
 * document change, not *how* — whether the user picked up the wire tool, drew
 * a rail, dropped a text box. This is the one place that says so.
 *
 * One event per ACTIVATION: fired when `activeTool` changes to a drawing tool,
 * never per pointer move or per placement while it stays active. Re-pressing
 * the tool that is already active is not a new activation. `select` and `pan`
 * are navigation, not drawing, and are not reported. Neither is anything in a
 * read-only viewer.
 *
 * Also one event per COMPLETED circuit gesture (`kind: 'gesture'`): placing
 * a contact via "Add contact", placing from the quick-insert palette,
 * dropping a symbol into a wire, pulling a branch out of a rail, hanging a
 * symbol from a rail (see `store/gesture-events`). Reported when the gesture
 * changes the drawing, each time it does — opening a menu or starting a drag
 * reports nothing. One action can complete two gestures (a quick-insert pick
 * that lands on a wire reports `quick_insert` and `insert_on_wire`).
 */

import { useEffect, useRef } from 'react';
import { useEditorStore, type ToolId } from '../store';
import type { DiagramType } from '../model';
import { onGesture, type GestureId } from '../store/gesture-events';

export type { GestureId } from '../store/gesture-events';

export interface ToolUseEvent {
  /**
   * The drawing tool that became active (`wire`, `busbar`, `place`, `text`,
   * …), or, with `kind: 'gesture'`, the gesture that completed
   * (`add_contact`, `quick_insert`, `insert_on_wire`, `rail_branch`,
   * `rail_hang`).
   */
  tool: ToolId | GestureId;
  /** The document's type at the moment of activation. */
  diagramType: DiagramType;
  /** Present (`'gesture'`) only on gesture events; absent on tool activations. */
  kind?: 'gesture';
}

const NOT_DRAWING: ReadonlySet<ToolId> = new Set<ToolId>(['select', 'pan']);

export function useToolUseReporter(
  onToolUse: ((e: ToolUseEvent) => void) | undefined,
  readOnly: boolean | undefined,
): void {
  const cb = useRef(onToolUse);
  cb.current = onToolUse;
  const enabled = !!onToolUse && !readOnly;

  useEffect(() => {
    if (!enabled) return;
    let prev = useEditorStore.getState().activeTool;
    return useEditorStore.subscribe((s) => {
      const tool = s.activeTool;
      if (tool === prev) return;
      prev = tool;
      if (NOT_DRAWING.has(tool)) return;
      try {
        cb.current?.({ tool, diagramType: s.diagram.meta?.diagramType ?? 'sld' });
      } catch {
        // A host's analytics must never break the editor.
      }
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    return onGesture((tool) => {
      const diagramType = useEditorStore.getState().diagram.meta?.diagramType ?? 'sld';
      try {
        cb.current?.({ tool, diagramType, kind: 'gesture' });
      } catch {
        // A host's analytics must never break the editor.
      }
    });
  }, [enabled]);
}
