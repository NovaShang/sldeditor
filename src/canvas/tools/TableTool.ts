/**
 * Table annotation tool. Two gestures, Word-style:
 *   - Drag: sweep out an area; the live preview shows the grid and a
 *     "cols × rows" badge (cell count derives from the default cell size).
 *   - Click (below the drag threshold): drop a default 3×3 table.
 *
 * Cells start empty; double-click a cell (select tool) to type into it.
 */

import { useEditorStore } from '../../store';
import { draftTable, makeTableBody } from '../../lib/annotation-geom';
import { snapPoint } from '../grid';
import { exitToPanOnPhone } from '../touch';
import type { Tool } from './types';

/** Drags smaller than this (both axes) count as a click → default table. */
const CLICK_THRESHOLD = 15;
const DEFAULT_COLS = 3;
const DEFAULT_ROWS = 3;

export const TableTool: Tool = {
  id: 'table',
  cursor: 'crosshair',

  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = snapPoint(ctx.viewport.screenToSvg(e.clientX, e.clientY));
    useEditorStore.getState().setAnnotationDraft({
      kind: 'table',
      start,
      current: start,
      constrain: false,
    });
  },

  onPointerMove(e, ctx) {
    const store = useEditorStore.getState();
    const draft = store.annotationDraft;
    if (!draft) return;
    store.setAnnotationDraft({
      ...draft,
      current: snapPoint(ctx.viewport.screenToSvg(e.clientX, e.clientY)),
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
    const w = Math.abs(current[0] - draft.start[0]);
    const h = Math.abs(current[1] - draft.start[1]);
    const isClick = w < CLICK_THRESHOLD && h < CLICK_THRESHOLD;
    const { at, cols, rows } = isClick
      ? { at: draft.start, cols: DEFAULT_COLS, rows: DEFAULT_ROWS }
      : draftTable({ ...draft, current });
    const id = store.insertAnnotation({
      type: 'table',
      at,
      ...makeTableBody(cols, rows),
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
