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

  if (mode === 'off') return null;

  return (
    <g className="ole-annotation-layer" pointerEvents="none">
      {Array.from(elements.values()).map((re) => {
        const place = layout.get(re.element.id);
        if (!place || !re.libraryDef) return null;
        const lines = labelLines(re, mode);
        if (lines.length === 0) return null;
        const anchor = re.libraryDef.label ?? fallbackAnchor(re.libraryDef);
        const world = anchorWorld(anchor, place, re.libraryDef);
        const textAnchor = anchor.anchor ?? 'start';
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
  lib: LibraryEntry,
): [number, number] {
  let x = anchor.x;
  let y = anchor.y;

  // Stretch (only meaningful for stretchable kinds with an explicit span).
  const stretch = lib.stretchable;
  if (stretch && place.span) {
    const k = place.span / stretch.naturalSpan;
    if (stretch.axis === 'x') x *= k;
    else y *= k;
  }
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
