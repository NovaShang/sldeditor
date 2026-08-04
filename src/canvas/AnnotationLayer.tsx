/**
 * Renders structural labels (element ID + showOnCanvas params) next to each
 * element. Labels are derived purely from `Element` data and the library
 * schema — they do not live in the diagram's serialized form.
 *
 * The label block is positioned at the world projection of the element's
 * `LibraryEntry.label` anchor (or a viewBox-derived fallback). Element
 * rotation moves the anchor accordingly, but the text itself is rendered
 * upright (no rotate on the text group) so labels stay readable.
 *
 * Visibility is governed by `DiagramFile.meta.labelMode`:
 *   - 'off' → no labels.
 *   - 'id'  → element name/ID only.
 *   - 'all' → ID plus each library param marked `showOnCanvas: true`.
 * Default when unset: 'all'.
 *
 * Type size comes from `DiagramFile.meta.labelFontSize`. The glyph size itself
 * is a stylesheet concern (`.ole-annotation-text`), so the document value is
 * published as the `--ole-label-font-size` custom property on this layer's
 * group and the stylesheet reads it — leaving the class free to be restyled by
 * a host and defaulting to 7px when the field is absent. The *geometry*
 * (baseline nudge, line stacking, wire-label offset) takes the same size as an
 * argument so the canvas can't drift from the SVG / DXF exporters.
 *
 * Wire labels (`Wire.label`, e.g. phase designations L1/L2/L3/N/PE) render
 * here too — anchored mid-wire via `placeWireLabel`, hidden at 'off'.
 */

import { useEffect, useRef } from 'react';
import { useEditorStore } from '../store';
import type { LabelMode } from '../model';
import {
  fallbackAnchor,
  labelLineHeight,
  labelLines,
  placeLabel,
  resolveLabelFontSize,
} from '../lib/element-labels';
import { placeWireLabel } from '../lib/wire-labels';

export function AnnotationLayer() {
  const elements = useEditorStore((s) => s.internal.elements);
  const layout = useEditorStore((s) => s.internal.layout);
  const wireRenders = useEditorStore((s) => s.internal.wireRenders);
  const mode: LabelMode = useEditorStore(
    (s) => s.diagram.meta?.labelMode ?? 'all',
  );
  const fontSize = useEditorStore((s) =>
    resolveLabelFontSize(s.diagram.meta?.labelFontSize),
  );
  const editingElement = useEditorStore((s) => s.editingElement);
  const lineHeight = labelLineHeight(fontSize);

  return (
    <g
      className="ole-annotation-layer"
      pointerEvents="none"
      style={{ '--ole-label-font-size': `${fontSize}px` } as React.CSSProperties}
    >
      {Array.from(elements.values()).map((re) => {
        const place = layout.get(re.element.id);
        if (!place || !re.libraryDef) return null;
        const anchor = re.libraryDef.label ?? fallbackAnchor(re.libraryDef, fontSize);
        const lines = labelLines(re, mode);
        const { world, textAnchor, dy } = placeLabel(
          anchor,
          re.libraryDef,
          place,
          Math.max(1, lines.length),
          fontSize,
        );
        if (editingElement === re.element.id) {
          return (
            <NameEditor
              key={re.element.id}
              elementId={re.element.id}
              currentName={re.element.name?.trim() || re.element.id}
              world={world}
              anchor={textAnchor}
              fontSize={fontSize}
            />
          );
        }
        if (mode === 'off') return null;
        if (lines.length === 0) return null;
        return (
          <g
            key={re.element.id}
            className="ole-annotation"
            transform={`translate(${world[0]} ${world[1]})`}
          >
            {lines.map((line, i) => (
              <text
                key={i}
                x={0}
                y={dy + i * lineHeight}
                textAnchor={textAnchor}
                className="ole-annotation-text"
              >
                {line}
              </text>
            ))}
          </g>
        );
      })}
      {mode !== 'off' &&
        Array.from(wireRenders.values()).map((r) => {
          const label = r.label?.trim();
          if (!label) return null;
          const placed = placeWireLabel(r.path, fontSize);
          if (!placed) return null;
          return (
            <text
              key={`wire-${r.wireId}`}
              x={placed.world[0]}
              y={placed.world[1]}
              textAnchor={placed.textAnchor}
              className="ole-annotation-text"
            >
              {label}
            </text>
          );
        })}
    </g>
  );
}

const EDITOR_W = 200;
const EDITOR_FS = 9;

/**
 * In-place editor for an element's `name`. Mounted at the same anchor as
 * the structural label so the inline edit happens where the user expects
 * to see the name. Empty content clears the override (label falls back to
 * the element's ID); non-empty content sets `Element.name`.
 *
 * The editor is a touch larger than the label it stands in for (easier to hit
 * and read while typing) but never smaller — so a document with enlarged
 * labels edits at the size it renders at.
 */
function NameEditor({
  elementId,
  currentName,
  world,
  anchor,
  fontSize,
}: {
  elementId: string;
  currentName: string;
  world: [number, number];
  anchor: 'start' | 'middle' | 'end';
  fontSize: number;
}) {
  const fs = Math.max(EDITOR_FS, fontSize);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [elementId]);

  function commit(): void {
    const store = useEditorStore.getState();
    const el = store.diagram.elements.find((x) => x.id === elementId);
    if (!el) {
      store.setEditingElement(null);
      return;
    }
    const text = (ref.current?.innerText ?? '').replace(/\u00a0/g, ' ').trim();
    // Empty text clears the override; the structural label falls back to ID.
    const next = text === '' || text === elementId ? undefined : text;
    if (next !== el.name) store.updateElement(elementId, { name: next });
    store.setEditingElement(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault();
      commit();
      return;
    }
    e.stopPropagation();
  }

  // Position the foreignObject so the contentEditable's left edge matches
  // the requested SVG text-anchor — text-anchor is glyph-relative, but our
  // editor is a div without that semantic, so we translate by hand.
  let x = world[0];
  if (anchor === 'middle') x -= EDITOR_W / 2;
  else if (anchor === 'end') x -= EDITOR_W;

  return (
    <foreignObject
      x={x}
      y={world[1] - fs}
      width={EDITOR_W}
      height={fs * 2.2}
      className="ole-element-name-editor"
    >
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onBlur={commit}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          fontSize: `${fs}px`,
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          color: 'var(--foreground)',
          background: 'var(--canvas-bg)',
          outline: '1px dashed var(--selection)',
          padding: '0 2px',
          display: 'inline-block',
          minWidth: '20px',
          lineHeight: 1.1,
          textAlign:
            anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left',
          whiteSpace: 'nowrap',
          cursor: 'text',
        }}
      >
        {currentName}
      </div>
    </foreignObject>
  );
}

