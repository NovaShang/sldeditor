/**
 * Line annotation tool: click-and-drag to draw a straight decoration line
 * (divider / leader). Shift constrains the direction to 45° steps. Arrowheads
 * are off by default and toggled in the property panel after the fact.
 *
 * Points are stored relative to `at` (= the drag start) so moving the line is
 * a plain `at` patch, same as every other annotation.
 */

import { useEditorStore } from '../../store';
import { draftLineEnd, MIN_LINE_LEN } from '../../lib/annotation-geom';
import { snapPoint } from '../grid';
import { exitToPanOnPhone } from '../touch';
import type { Tool } from './types';

export const LineTool: Tool = {
  id: 'line',
  cursor: 'crosshair',

  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = snapPoint(ctx.viewport.screenToSvg(e.clientX, e.clientY));
    useEditorStore.getState().setAnnotationDraft({
      kind: 'line',
      start,
      current: start,
      constrain: e.shiftKey,
    });
  },

  onPointerMove(e, ctx) {
    const store = useEditorStore.getState();
    const draft = store.annotationDraft;
    if (!draft) return;
    store.setAnnotationDraft({
      ...draft,
      current: snapPoint(ctx.viewport.screenToSvg(e.clientX, e.clientY)),
      constrain: e.shiftKey,
    });
  },

  onPointerUp(e, ctx) {
    const store = useEditorStore.getState();
    const draft = store.annotationDraft;
    store.setAnnotationDraft(null);
    if (!draft) return;
    // Commit from the release point itself — the last pointermove can lag
    // (or be absent entirely for synthetic/very fast drags).
    const current = snapPoint(ctx.viewport.screenToSvg(e.clientX, e.clientY));
    const end = draftLineEnd({ ...draft, current, constrain: e.shiftKey });
    const dx = end[0] - draft.start[0];
    const dy = end[1] - draft.start[1];
    if (Math.hypot(dx, dy) < MIN_LINE_LEN) return;
    const id = store.insertAnnotation({
      type: 'line',
      at: draft.start,
      points: [
        [0, 0],
        [dx, dy],
      ],
    });
    store.setSelectedAnnotation(id);
    store.setActiveTool('select');
    exitToPanOnPhone();
  },

  onPointerLeave() {
    useEditorStore.getState().setAnnotationDraft(null);
  },

  onPointerCancel() {
    useEditorStore.getState().setAnnotationDraft(null);
  },

  onDeactivate() {
    useEditorStore.getState().setAnnotationDraft(null);
  },
};
