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
 */

import { useEffect, useRef } from 'react';
import { useEditorStore, type ToolId } from '../store';
import type { DiagramType } from '../model';

export interface ToolUseEvent {
  /** The drawing tool that became active (`wire`, `busbar`, `place`, `text`, …). */
  tool: ToolId;
  /** The document's type at the moment of activation. */
  diagramType: DiagramType;
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
}
