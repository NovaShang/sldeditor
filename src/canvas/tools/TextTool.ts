/**
 * Text tool: click anywhere on empty canvas to drop a free text annotation
 * at the cursor and immediately enter inline-edit mode. After committing
 * (Enter / blur), control returns to the select tool with the annotation
 * still selected so users can keep moving / resizing it.
 *
 * Clicking on an existing annotation focuses it for re-edit instead of
 * dropping a new one.
 */

import { useEditorStore } from '../../store';
import { hitAnnotation } from '../hit-test';
import type { Tool } from './types';

export const TextTool: Tool = {
  id: 'text',
  cursor: 'text',

  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    const store = useEditorStore.getState();

    const existing = hitAnnotation(e.target);
    if (existing) {
      e.preventDefault();
      e.stopPropagation();
      store.setEditingAnnotation(existing);
      return;
    }

    e.preventDefault();
    const pt = ctx.viewport.screenToSvg(e.clientX, e.clientY);
    const id = store.addAnnotation([pt[0], pt[1]], '');
    store.setEditingAnnotation(id);
  },
};
