/**
 * Live ghost for the annotation drawing tools (rect / line / table). Reads
 * `annotationDraft` from the store and renders exactly the geometry the tool
 * would commit — both sides call the same `draft*` helpers in
 * `lib/annotation-geom`, so the preview can never lie about the result.
 *
 * The table preview adds a "cols × rows" count badge near the cursor,
 * mirroring word-processor table insertion.
 */

import { useEditorStore } from '../store';
import {
  ANNOTATION_DASH,
  draftLineEnd,
  draftRect,
  draftTable,
  TABLE_DEFAULT_CELL_H,
  TABLE_DEFAULT_CELL_W,
} from '../lib/annotation-geom';

export function AnnotationDraftPreview() {
  const draft = useEditorStore((s) => s.annotationDraft);
  if (!draft) return null;

  if (draft.kind === 'rect') {
    const { at, size } = draftRect(draft);
    return (
      <g className="ole-ann-draft" pointerEvents="none">
        <rect x={at[0]} y={at[1]} width={size[0]} height={size[1]} strokeDasharray={ANNOTATION_DASH} />
      </g>
    );
  }

  if (draft.kind === 'line') {
    const end = draftLineEnd(draft);
    return (
      <g className="ole-ann-draft" pointerEvents="none">
        <line x1={draft.start[0]} y1={draft.start[1]} x2={end[0]} y2={end[1]} />
      </g>
    );
  }

  // Table: uniform default-size cells; the count follows the swept area.
  const { at, cols, rows } = draftTable(draft);
  const w = cols * TABLE_DEFAULT_CELL_W;
  const h = rows * TABLE_DEFAULT_CELL_H;
  const lines: React.ReactNode[] = [];
  for (let c = 1; c < cols; c++) {
    const x = at[0] + c * TABLE_DEFAULT_CELL_W;
    lines.push(<line key={`c${c}`} x1={x} y1={at[1]} x2={x} y2={at[1] + h} />);
  }
  for (let r = 1; r < rows; r++) {
    const y = at[1] + r * TABLE_DEFAULT_CELL_H;
    lines.push(<line key={`r${r}`} x1={at[0]} y1={y} x2={at[0] + w} y2={y} />);
  }
  return (
    <g className="ole-ann-draft" pointerEvents="none">
      <rect x={at[0]} y={at[1]} width={w} height={h} />
      {lines}
      <text
        className="ole-ann-draft-badge"
        x={draft.current[0] + 12}
        y={draft.current[1] - 8}
      >
        {cols} × {rows}
      </text>
    </g>
  );
}
