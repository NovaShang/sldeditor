/**
 * Rect annotation tool: click-and-drag to draw a rectangle / group frame.
 * Shift constrains to a square. The in-progress drag is published as
 * `annotationDraft`; `AnnotationDraftPreview` renders the live ghost.
 *
 * Commit (pointerup) creates a dashed, unfilled rect — the group-frame
 * defaults — selects it and returns to the select tool (one-shot, like the
 * text tool), where the resize handles and property panel take over.
 * Sub-minimum drags (accidental clicks) commit nothing.
 */

import { useEditorStore } from '../../store';
import { draftRect, MIN_RECT_SIZE } from '../../lib/annotation-geom';
import { snapPoint } from '../grid';
import { exitToPanOnPhone } from '../touch';
import type { Tool } from './types';

export const RectTool: Tool = {
  id: 'rect',
  cursor: 'crosshair',

  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = snapPoint(ctx.viewport.screenToSvg(e.clientX, e.clientY));
    useEditorStore.getState().setAnnotationDraft({
      kind: 'rect',
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
    const { at, size } = draftRect({ ...draft, current, constrain: e.shiftKey });
    if (size[0] < MIN_RECT_SIZE || size[1] < MIN_RECT_SIZE) return;
    const id = store.insertAnnotation({
      type: 'rect',
      at,
      size,
      stroke: 'dashed',
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
