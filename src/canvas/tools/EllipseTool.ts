/**
 * Ellipse annotation tool: click-and-drag to draw an ellipse inside the swept
 * box. Shift constrains to a circle. Mirrors `RectTool` exactly — same draft
 * publishing, same one-shot return to select — because the two shapes are
 * anchored by the same bounding box.
 *
 * Committed solid rather than dashed: a rect defaults to dashed because its
 * job is the group frame, but an ellipse is a shape the user is drawing, not
 * a boundary they are implying.
 */

import { useEditorStore } from '../../store';
import { draftRect, MIN_RECT_SIZE } from '../../lib/annotation-geom';
import { snapPoint } from '../grid';
import { exitToPanOnPhone } from '../touch';
import type { Tool } from './types';

export const EllipseTool: Tool = {
  id: 'ellipse',
  cursor: 'crosshair',

  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = snapPoint(ctx.viewport.screenToSvg(e.clientX, e.clientY));
    useEditorStore.getState().setAnnotationDraft({
      kind: 'ellipse',
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
    const id = store.insertAnnotation({ type: 'ellipse', at, size });
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
