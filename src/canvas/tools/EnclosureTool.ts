/**
 * Enclosure tool: drag a frame around a panel / cabinet / junction box. The
 * gesture is the rect tool's exactly (same draft, same preview, same
 * minimum); only the committed annotation differs. The new enclosure is
 * selected and the tool returns to select, where the property panel takes
 * the name and the box grips take the size.
 */

import { useEditorStore } from '../../store';
import { draftRect, MIN_RECT_SIZE } from '../../lib/annotation-geom';
import { snapPoint } from '../grid';
import { exitToPanOnPhone } from '../touch';
import type { Tool } from './types';

export const EnclosureTool: Tool = {
  id: 'enclosure',
  cursor: 'crosshair',

  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = snapPoint(ctx.viewport.screenToSvg(e.clientX, e.clientY));
    useEditorStore.getState().setAnnotationDraft({
      kind: 'enclosure',
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
    const id = store.insertAnnotation({ type: 'enclosure', at, size });
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
