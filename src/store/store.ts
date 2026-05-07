/**
 * Zustand store — the single source of truth for the editor.
 *
 * The DiagramFile is authoritative; `internal` is a derived projection,
 * recomputed on every replacement. Future editing actions will mutate
 * `diagram` and re-run `compile` automatically. Viewport (pan/zoom) is
 * deliberately *not* in this store: it lives on a DOM ref to avoid
 * triggering React re-renders during drag/wheel gestures.
 */

import { create } from 'zustand';
import { compile, type InternalModel } from '@/compiler';
import type { DiagramFile } from '@/model';

const EMPTY_DIAGRAM: DiagramFile = { version: '1', elements: [] };

export interface EditorState {
  diagram: DiagramFile;
  internal: InternalModel;
  setDiagram: (diagram: DiagramFile) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  diagram: EMPTY_DIAGRAM,
  internal: compile(EMPTY_DIAGRAM),
  setDiagram: (diagram) => set({ diagram, internal: compile(diagram) }),
}));
