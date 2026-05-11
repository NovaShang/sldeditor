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
 */

import { useEffect, useRef } from 'react';
import { useEditorStore } from '../store';
import type {
  LabelMode,
  LibraryEntry,
  LibraryLabelAnchor,
} from '../model';
import type { ResolvedElement, ResolvedPlacement } from '../compiler';

const LINE_HEIGHT = 9;

export function AnnotationLayer() {
  const elements = useEditorStore((s) => s.internal.elements);
  const layout = useEditorStore((s) => s.internal.layout);
  const mode: LabelMode = useEditorStore(
    (s) => s.diagram.meta?.labelMode ?? 'all',
  );
  const editingElement = useEditorStore((s) => s.editingElement);

  return (
    <g className="ole-annotation-layer" pointerEvents="none">
      {Array.from(elements.values()).map((re) => {
        const place = layout.get(re.element.id);
        if (!place || !re.libraryDef) return null;
        const anchor = re.libraryDef.label ?? fallbackAnchor(re.libraryDef);
        const world = anchorWorld(anchor, place, re.libraryDef);
        const textAnchor = anchor.anchor ?? 'start';
        if (editingElement === re.element.id) {
          return (
            <NameEditor
              key={re.element.id}
              elementId={re.element.id}
              currentName={re.element.name?.trim() || re.element.id}
              world={world}
              anchor={textAnchor}
            />
          );
        }
        if (mode === 'off') return null;
        const lines = labelLines(re, mode);
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
                y={i * LINE_HEIGHT}
                textAnchor={textAnchor}
                className="ole-annotation-text"
              >
                {line}
              </text>
            ))}
          </g>
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
 */
function NameEditor({
  elementId,
  currentName,
  world,
  anchor,
}: {
  elementId: string;
  currentName: string;
  world: [number, number];
  anchor: 'start' | 'middle' | 'end';
}) {
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
      y={world[1] - EDITOR_FS}
      width={EDITOR_W}
      height={EDITOR_FS * 2.2}
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
          fontSize: `${EDITOR_FS}px`,
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

function labelLines(re: ResolvedElement, mode: LabelMode): string[] {
  const lines: string[] = [];
  const head = re.element.name?.trim() || re.element.id;
  if (head) lines.push(head);
  if (mode !== 'all' || !re.libraryDef?.params) return lines;
  const params = re.element.params ?? {};
  for (const p of re.libraryDef.params) {
    if (!p.showOnCanvas) continue;
    const v = params[p.name];
    if (v === undefined || v === null || v === '') continue;
    lines.push(`${v}${p.unit ?? ''}`);
  }
  return lines;
}

function fallbackAnchor(lib: LibraryEntry): LibraryLabelAnchor {
  const vb = parseViewBox(lib.viewBox);
  if (!vb) return { x: 0, y: 0, anchor: 'start' };
  return { x: vb.x + vb.w + 2, y: vb.y + 4, anchor: 'start' };
}

function parseViewBox(s: string): { x: number; y: number; w: number; h: number } | null {
  const parts = s.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
}

/**
 * Project an element-local point through the element's placement transform —
 * matches `transformAttr`'s composition (stretch → mirror → rotate → translate)
 * but yields a single world coordinate so the label can be rendered without
 * inheriting the element's rotation.
 */
function anchorWorld(
  anchor: LibraryLabelAnchor,
  place: ResolvedPlacement,
  _lib: LibraryEntry,
): [number, number] {
  let x = anchor.x;
  let y = anchor.y;

  // Mirror flips local x.
  if (place.mirror) x = -x;
  // Rotation (90° steps).
  switch (place.rot) {
    case 90:
      [x, y] = [-y, x];
      break;
    case 180:
      [x, y] = [-x, -y];
      break;
    case 270:
      [x, y] = [y, -x];
      break;
    default:
      break;
  }
  return [x + place.at[0], y + place.at[1]];
}
