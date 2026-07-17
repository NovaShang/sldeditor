/**
 * Renders user-created free annotations from `diagram.annotations` — text
 * notes, rect group-frames, lines and tables. All variants share the
 * conventions established by text notes:
 *
 *   - the wrapping group carries `data-annotation-id` for DOM hit-testing;
 *   - `data-selected` drives the CSS selection recolor;
 *   - moving is handled generically by SelectTool (drag → patch `at`).
 *
 * Hit semantics differ deliberately per shape:
 *   - text: a padded invisible rect over the block (small, harmless);
 *   - rect: **border only** — the interior stays click-transparent so a
 *     group frame never blocks selecting the devices inside it;
 *   - line: a fat invisible stroke band along the polyline;
 *   - table: the whole surface (tables are opaque objects, not overlays).
 *
 * While a resize/vertex handle drag is in flight, `annotationPreview`
 * overrides the model annotation with the same id so the shape tracks the
 * pointer without touching the undo history.
 */

import { useEffect, useRef } from 'react';
import { useEditorStore } from '../store';
import {
  annotationKind,
  type Annotation,
  type LineAnnotation,
  type RectAnnotation,
  type TableAnnotation,
  type TextAnnotation,
} from '../model';
import {
  ANNOTATION_DASH,
  ANNOTATION_FONT_SIZE,
  lineAbsPoints,
  lineArrowHeads,
  RECT_LABEL_PAD,
  TABLE_CELL_PAD_X,
  tableColEdges,
  tableRowEdges,
  tableSize,
} from '../lib/annotation-geom';

const DEFAULT_FONT_SIZE = ANNOTATION_FONT_SIZE;
const LINE_HEIGHT = 1.25;

export function FreeAnnotationLayer() {
  const annotations = useEditorStore((s) => s.diagram.annotations);
  const selected = useEditorStore((s) => s.selectedAnnotation);
  const editing = useEditorStore((s) => s.editingAnnotation);
  const editingCell = useEditorStore((s) => s.editingCell);
  const preview = useEditorStore((s) => s.annotationPreview);

  if (!annotations || annotations.length === 0) return null;

  return (
    <g className="ole-free-annotation-layer">
      {annotations.map((a) => {
        const eff: Annotation = preview?.id === a.id ? preview : a;
        const isSelected = selected === a.id;
        switch (annotationKind(eff)) {
          case 'rect':
            return (
              <RectView
                key={a.id}
                ann={eff as RectAnnotation}
                isSelected={isSelected}
              />
            );
          case 'line':
            return (
              <LineView
                key={a.id}
                ann={eff as LineAnnotation}
                isSelected={isSelected}
              />
            );
          case 'table':
            return (
              <TableView
                key={a.id}
                ann={eff as TableAnnotation}
                isSelected={isSelected}
                editingCell={editing === a.id ? editingCell : null}
              />
            );
          default:
            return editing === a.id ? (
              <EditingAnnotation key={a.id} ann={eff as TextAnnotation} />
            ) : (
              <IdleAnnotation
                key={a.id}
                ann={eff as TextAnnotation}
                isSelected={isSelected}
              />
            );
        }
      })}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Rect — plain box / labeled group frame.
// ---------------------------------------------------------------------------

function RectView({
  ann,
  isSelected,
}: {
  ann: RectAnnotation;
  isSelected: boolean;
}) {
  const [x, y] = ann.at;
  const [w, h] = ann.size;
  const dash =
    (ann.stroke ?? 'dashed') === 'dashed' ? ANNOTATION_DASH : undefined;
  return (
    <g
      data-annotation-id={ann.id}
      className="ole-ann ole-ann-rect"
      data-selected={isSelected ? 'true' : undefined}
    >
      {ann.fill === 'tint' && (
        <rect className="ole-ann-fill" x={x} y={y} width={w} height={h} />
      )}
      {/* Fat transparent border band — the grab/select target. Interior is
          intentionally not hit so content inside a group frame stays
          clickable. */}
      <rect className="ole-ann-shape-hit" x={x} y={y} width={w} height={h} />
      <rect
        className="ole-ann-rect-border"
        x={x}
        y={y}
        width={w}
        height={h}
        strokeDasharray={dash}
      />
      {ann.label && (
        <text
          className="ole-ann-label"
          x={x + RECT_LABEL_PAD}
          y={y + RECT_LABEL_PAD + DEFAULT_FONT_SIZE * 0.85}
          fontSize={DEFAULT_FONT_SIZE}
        >
          {ann.label}
        </text>
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Line — divider / leader with optional arrowheads.
// ---------------------------------------------------------------------------

function LineView({
  ann,
  isSelected,
}: {
  ann: LineAnnotation;
  isSelected: boolean;
}) {
  const pts = lineAbsPoints(ann);
  const ptsAttr = pts.map((p) => `${p[0]},${p[1]}`).join(' ');
  const dash =
    (ann.stroke ?? 'solid') === 'dashed' ? ANNOTATION_DASH : undefined;
  return (
    <g
      data-annotation-id={ann.id}
      className="ole-ann ole-ann-line-group"
      data-selected={isSelected ? 'true' : undefined}
    >
      <polyline className="ole-ann-shape-hit" points={ptsAttr} />
      <polyline
        className="ole-ann-line"
        points={ptsAttr}
        strokeDasharray={dash}
      />
      {lineArrowHeads(pts, ann.arrow).map((tri, i) => (
        <polygon
          key={i}
          className="ole-ann-arrow"
          points={tri.map((p) => `${p[0]},${p[1]}`).join(' ')}
        />
      ))}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Table — opaque grid with per-cell text and inline cell editing.
// ---------------------------------------------------------------------------

function TableView({
  ann,
  isSelected,
  editingCell,
}: {
  ann: TableAnnotation;
  isSelected: boolean;
  editingCell: [number, number] | null;
}) {
  const [x, y] = ann.at;
  const [w, h] = tableSize(ann);
  const colE = tableColEdges(ann);
  const rowE = tableRowEdges(ann);
  const fs = ann.fontSize ?? DEFAULT_FONT_SIZE;

  // Internal grid lines as one path (cheap even for large tables).
  let grid = '';
  for (let c = 1; c < ann.colWidths.length; c++) {
    grid += `M${x + colE[c]} ${y}V${y + h}`;
  }
  for (let r = 1; r < ann.rowHeights.length; r++) {
    grid += `M${x} ${y + rowE[r]}H${x + w}`;
  }

  const texts: React.ReactNode[] = [];
  const clips: React.ReactNode[] = [];
  for (let r = 0; r < ann.rowHeights.length; r++) {
    for (let c = 0; c < ann.colWidths.length; c++) {
      const value = ann.cells[r]?.[c] ?? '';
      if (value === '') continue;
      const cw = ann.colWidths[c];
      const tx = x + colE[c] + TABLE_CELL_PAD_X;
      const ty = y + rowE[r] + ann.rowHeights[r] / 2 + fs * 0.35;
      // Clip only when the text likely overflows its cell — keeps the DOM
      // lean for the common short-label case.
      const needsClip = value.length * fs * 0.55 > cw - 2 * TABLE_CELL_PAD_X;
      const clipId = `ole-ann-clip-${ann.id}-${r}-${c}`;
      if (needsClip) {
        clips.push(
          <clipPath key={clipId} id={clipId}>
            <rect
              x={x + colE[c]}
              y={y + rowE[r]}
              width={cw}
              height={ann.rowHeights[r]}
            />
          </clipPath>,
        );
      }
      texts.push(
        <text
          key={`${r}-${c}`}
          className="ole-ann-table-text"
          x={tx}
          y={ty}
          fontSize={fs}
          clipPath={needsClip ? `url(#${clipId})` : undefined}
        >
          {value}
        </text>,
      );
    }
  }

  return (
    <g
      data-annotation-id={ann.id}
      className="ole-ann ole-ann-table"
      data-selected={isSelected ? 'true' : undefined}
    >
      {clips.length > 0 && <defs>{clips}</defs>}
      <rect className="ole-ann-table-bg" x={x} y={y} width={w} height={h} />
      {grid && <path className="ole-ann-table-grid" d={grid} />}
      <rect className="ole-ann-table-border" x={x} y={y} width={w} height={h} />
      {texts}
      {editingCell && <CellEditor ann={ann} cell={editingCell} />}
    </g>
  );
}

/**
 * Inline editor for one table cell. Spreadsheet-style keyboard flow:
 * Enter commits + moves down, Tab / Shift+Tab move across (wrapping rows),
 * Esc commits + closes; blur commits + closes. Each committed change is one
 * undo entry (no-ops don't dispatch).
 */
function CellEditor({
  ann,
  cell,
}: {
  ann: TableAnnotation;
  cell: [number, number];
}) {
  const [row, col] = cell;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const colE = tableColEdges(ann);
  const rowE = tableRowEdges(ann);
  const fs = ann.fontSize ?? DEFAULT_FONT_SIZE;
  const value = ann.cells[row]?.[col] ?? '';

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [row, col]);

  function commit(): void {
    const store = useEditorStore.getState();
    const next = inputRef.current?.value ?? '';
    if (next !== value) {
      const cells = ann.cells.map((r) => [...r]);
      while (cells.length <= row) cells.push([]);
      cells[row][col] = next;
      store.updateAnnotation(ann.id, { cells });
    }
  }

  function close(): void {
    useEditorStore.getState().setEditingAnnotation(null);
  }

  function moveTo(r: number, c: number): void {
    const rows = ann.rowHeights.length;
    const cols = ann.colWidths.length;
    if (c >= cols) {
      c = 0;
      r += 1;
    } else if (c < 0) {
      c = cols - 1;
      r -= 1;
    }
    if (r < 0 || r >= rows) {
      close();
      return;
    }
    useEditorStore.getState().setEditingCell([r, c]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      moveTo(row + 1, col);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      commit();
      moveTo(row, e.shiftKey ? col - 1 : col + 1);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      // Cancel = discard: restore the pre-edit value so the commit is a no-op.
      if (inputRef.current) inputRef.current.value = value;
      commit();
      close();
      return;
    }
    // Keep keystrokes away from global hotkeys (Delete, tool switches…).
    e.stopPropagation();
  }

  return (
    <foreignObject
      x={ann.at[0] + colE[col]}
      y={ann.at[1] + rowE[row]}
      width={ann.colWidths[col]}
      height={ann.rowHeights[row]}
      className="ole-ann-cell-edit-fo"
    >
      <input
        key={`${row}-${col}`}
        ref={inputRef}
        defaultValue={value}
        onBlur={() => {
          commit();
          close();
        }}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          border: '1px solid var(--selection)',
          outline: 'none',
          background: 'var(--canvas-bg)',
          color: 'var(--foreground)',
          font: `${fs}px ui-sans-serif, system-ui, sans-serif`,
          padding: `0 ${TABLE_CELL_PAD_X}px`,
        }}
      />
    </foreignObject>
  );
}

// ---------------------------------------------------------------------------
// Text — unchanged behavior from the original text-only layer.
// ---------------------------------------------------------------------------

function IdleAnnotation({
  ann,
  isSelected,
}: {
  ann: TextAnnotation;
  isSelected: boolean;
}) {
  const fs = ann.fontSize ?? DEFAULT_FONT_SIZE;
  const lines = ann.text === '' ? [''] : ann.text.split('\n');
  // Reasonable bbox estimate purely for the selection halo. Width is heuristic
  // (avg ~0.55 em per char); the actual click hit is on the text glyphs.
  const widthGuess = Math.max(
    20,
    ...lines.map((l) => l.length * fs * 0.55),
  );
  const heightGuess = lines.length * fs * LINE_HEIGHT;
  return (
    <g
      data-annotation-id={ann.id}
      className="ole-free-annotation"
      data-selected={isSelected ? 'true' : undefined}
    >
      {/* Invisible hit-rect for easier dragging on whitespace within the text block. */}
      <rect
        x={ann.at[0] - 1}
        y={ann.at[1] - 1}
        width={widthGuess + 2}
        height={heightGuess + 2}
        fill="transparent"
        className="ole-free-annotation-hit"
      />
      {isSelected && (
        <rect
          x={ann.at[0] - 1}
          y={ann.at[1] - 1}
          width={widthGuess + 2}
          height={heightGuess + 2}
          className="ole-free-annotation-halo"
        />
      )}
      {lines.map((line, i) => (
        <text
          key={i}
          x={ann.at[0]}
          y={ann.at[1] + fs * 0.85 + i * fs * LINE_HEIGHT}
          fontSize={fs}
          className="ole-free-annotation-text"
        >
          {line}
        </text>
      ))}
    </g>
  );
}

function EditingAnnotation({ ann }: { ann: TextAnnotation }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const fs = ann.fontSize ?? DEFAULT_FONT_SIZE;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Place caret at end and select-all so users can immediately type to
    // replace placeholder content (matches Figma / Keynote text-tool flow).
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [ann.id]);

  function commit(): void {
    const store = useEditorStore.getState();
    const text = (ref.current?.innerText ?? '').replace(/\u00a0/g, ' ').trimEnd();
    if (text === '') {
      store.deleteAnnotation(ann.id);
    } else if (text !== ann.text) {
      store.updateAnnotation(ann.id, { text });
    }
    store.setEditingAnnotation(null);
    if (text !== '') store.setSelectedAnnotation(ann.id);
    // Hand control back to the select tool — text mode is for one-off drops.
    if (store.activeTool === 'text') store.setActiveTool('select');
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      // Cancel = discard: restore the original text so the commit is a no-op
      // (an untouched brand-new empty note is cleaned up as before).
      if (ref.current) ref.current.innerText = ann.text;
      commit();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commit();
      return;
    }
    // Keep typing keys from leaking to global hotkeys (e.g. Delete deleting
    // the selection while the user is editing text).
    e.stopPropagation();
  }

  // foreignObject must be sized in canvas units; pick a generous box so the
  // editor can grow without clipping.
  const W = 320;
  const H = 200;
  return (
    <foreignObject
      x={ann.at[0]}
      y={ann.at[1]}
      width={W}
      height={H}
      data-annotation-id={ann.id}
      className="ole-free-annotation-edit-fo"
    >
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onBlur={commit}
        onKeyDown={onKeyDown}
        // The pointer events handler in useTools captures pointerdown on the
        // host before this; stop it here so clicks inside the editor don't
        // commit and re-enter unexpectedly.
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          fontSize: `${fs}px`,
          lineHeight: LINE_HEIGHT,
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          color: 'var(--foreground)',
          background: 'var(--canvas-bg)',
          outline: '1px dashed var(--selection)',
          padding: '0 2px',
          minWidth: `${fs}px`,
          minHeight: `${fs * LINE_HEIGHT}px`,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          cursor: 'text',
        }}
      >
        {ann.text}
      </div>
    </foreignObject>
  );
}
