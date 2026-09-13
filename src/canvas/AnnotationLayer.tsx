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

import { useEffect, useRef, useState } from 'react';
import { useCanvasStore, useEditorStore } from '../store';
import type { LabelMode } from '../model';
import {
  fallbackAnchor,
  labelBlockWidth,
  labelLineHeight,
  labelLines,
  nameLines,
  placeLabel,
  resolveLabelFontSize,
} from '../lib/element-labels';
import { placeWireLabel } from '../lib/wire-labels';
import { inkClass } from '../lib/colors';
import { useRuntime } from '../runtime/runtime-context';

export function AnnotationLayer() {
  const elements = useCanvasStore((s) => s.internal.elements);
  const layout = useCanvasStore((s) => s.internal.layout);
  const wireRenders = useCanvasStore((s) => s.internal.wireRenders);
  const mode: LabelMode = useCanvasStore(
    (s) => s.diagram.meta?.labelMode ?? 'all',
  );
  const fontSize = useCanvasStore((s) =>
    resolveLabelFontSize(s.diagram.meta?.labelFontSize),
  );
  const editingElement = useCanvasStore((s) => s.editingElement);
  // Live data (viewer only): a `label.text` binding replaces the whole block,
  // a hidden element takes its label with it.
  const runtime = useRuntime().props;
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
        const rt = runtime[re.element.id];
        if (rt?.visible === false) return null;
        const anchor = re.libraryDef.label ?? fallbackAnchor(re.libraryDef, fontSize);
        const lines =
          rt?.labelText !== undefined
            ? nameLines(rt.labelText, '')
            : labelLines(re, mode);
        const { world, textAnchor, dy } = placeLabel(
          anchor,
          re.libraryDef,
          place,
          Math.max(1, lines.length),
          fontSize,
          re.element.labelOffset,
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
        // The block is a drag target (SelectTool moves it and stores the
        // delta as `Element.labelOffset`), so it gets a transparent rect
        // behind the glyphs — hitting bare `<text>` means hitting the letter
        // strokes themselves, which is far too fiddly to grab. Opting back
        // into the pointer events this layer turns off wholesale is left to
        // the stylesheet, which does it ONLY under the select tool: any other
        // tool (or read-only, which attaches only pan) must keep clicking
        // straight through the label to the canvas underneath it.
        const blockW = labelBlockWidth(lines, fontSize);
        const blockX =
          textAnchor === 'middle' ? -blockW / 2 : textAnchor === 'end' ? -blockW : 0;
        return (
          <g
            key={re.element.id}
            className="ole-annotation ole-element-label"
            data-element-label={re.element.id}
            transform={`translate(${world[0]} ${world[1]})`}
          >
            {/* Inner group exists purely so SelectTool can park a live drag
                transform on it without clobbering the anchor translate
                above — a CSS transform would override the presentation
                attribute rather than compose with it. */}
            <g data-element-label-body="">
              <rect
                className="ole-element-label-hit"
                x={blockX - 2}
                y={dy - fontSize}
                width={blockW + 4}
                height={lines.length * lineHeight + fontSize * 0.4}
              />
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
              // A wire label takes its wire's ink; an element's structural
              // label deliberately does not. The two look alike but say
              // different things. An element label is the device's IDENTITY
              // (QF1, 630 A), orthogonal to whatever the colour is coding —
              // which is why electrical CAD (EPLAN, SEE) keeps device tags
              // neutral while the conductors carry the voltage/potential
              // colours. A wire label is a phase designation (L1/L2/L3/N/PE),
              // and phase colour-coding is the canonical reason to colour a
              // conductor at all: here the text IS what the colour is saying,
              // so a black "L1" beside a brown conductor reads as a mistake.
              className={[inkClass(r.color), 'ole-annotation-text']
                .filter(Boolean)
                .join(' ')}
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
 *
 * ENTER INSERTS A LINE BREAK; it does not commit. A device tag is routinely
 * stacked ("QF1" over "630A/25kA"), and this box is the only place a name is
 * typed, so Enter has to mean what it means in every other place you type a
 * multi-line label. Escape, clicking away, and ⌘/Ctrl+Enter all commit —
 * Escape kept its existing meaning (commit, not cancel) rather than quietly
 * changing under users who already rely on it.
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
  // The foreignObject clips its content, so it has to grow with the text.
  // Tracked from the live content rather than sized once, or the second line
  // a user types would be typed into an invisible box.
  const [lineCount, setLineCount] = useState(() =>
    Math.max(1, currentName.split('\n').length),
  );

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
    // Normalise through the same helper the label renderer uses, so what is
    // stored is exactly what will be drawn: per-line trim, blank lines
    // dropped (a stray trailing Enter is an accident, not a gap).
    const raw = (ref.current?.innerText ?? '').replace(/\u00a0/g, ' ');
    const text = nameLines(raw, '').join('\n');
    // Empty text clears the override; the structural label falls back to ID.
    const next = text === '' || text === elementId ? undefined : text;
    if (next !== el.name) store.updateElement(elementId, { name: next });
    store.setEditingElement(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      commit();
      return;
    }
    // Everything else — plain Enter included — is the editor's own; just keep
    // it away from the canvas hotkeys.
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
      height={fs * 1.3 * lineCount + fs}
      className="ole-element-name-editor"
    >
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onBlur={commit}
        onKeyDown={onKeyDown}
        onInput={() =>
          setLineCount(
            Math.max(1, (ref.current?.innerText ?? '').split('\n').length),
          )
        }
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
          whiteSpace: 'pre-wrap',
          cursor: 'text',
        }}
      >
        {currentName}
      </div>
    </foreignObject>
  );
}

