/**
 * Renders user-created free text annotations from `diagram.annotations`.
 * Each annotation is a draggable, editable note unattached to any element.
 *
 * Three render states per annotation:
 *   1. Idle              → `<text>` painted at its position.
 *   2. Selected (idle)   → text plus a dashed bbox halo (matches element halo).
 *   3. Editing           → `<foreignObject>` hosting a contentEditable div;
 *                          autoselects content on entry, commits on Enter or
 *                          blur, drops empty content on commit (auto-cleanup
 *                          of empty annotations created by the text tool).
 *
 * Hit-testing carries the annotation's id via `data-annotation-id` so tools
 * can route the gesture without React state lookups, mirroring how elements
 * use `data-element-id`.
 */

import { useEffect, useRef } from 'react';
import { useEditorStore } from '../store';
import type { TextAnnotation } from '../model';

const DEFAULT_FONT_SIZE = 8;
const LINE_HEIGHT = 1.25;

export function FreeAnnotationLayer() {
  const annotations = useEditorStore((s) => s.diagram.annotations);
  const selected = useEditorStore((s) => s.selectedAnnotation);
  const editing = useEditorStore((s) => s.editingAnnotation);

  if (!annotations || annotations.length === 0) return null;

  return (
    <g className="ole-free-annotation-layer">
      {annotations.map((a) =>
        editing === a.id ? (
          <EditingAnnotation key={a.id} ann={a} />
        ) : (
          <IdleAnnotation
            key={a.id}
            ann={a}
            isSelected={selected === a.id}
          />
        ),
      )}
    </g>
  );
}

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
