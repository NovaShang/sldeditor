/**
 * Renders one `<g>` per element. The library SVG fragment is inlined verbatim
 * via `dangerouslySetInnerHTML` — the library JSON is build-time content
 * (see `scripts/build-element-library.mjs`), not user input.
 *
 * Each `<g>` carries `data-element-id` so future tools can hit-test via
 * `event.target.closest('[data-element-id]')` without React state.
 */

import { useEditorStore } from '@/store';
import type { LibraryEntry } from '@/model';
import type { ResolvedPlacement } from '@/compiler';

export function ElementLayer() {
  const elements = useEditorStore((s) => s.internal.elements);
  const layout = useEditorStore((s) => s.internal.layout);

  return (
    <g className="ole-element-layer">
      {Array.from(elements.values()).map((re) => {
        const place = layout.get(re.element.id);
        if (!place) return null;

        if (!re.libraryDef) {
          // Unknown kind → small red placeholder square.
          return (
            <g
              key={re.element.id}
              data-element-id={re.element.id}
              transform={transformAttr(place, undefined)}
            >
              <rect
                x={-10}
                y={-10}
                width={20}
                height={20}
                fill="none"
                stroke="#EF4444"
                strokeWidth={1}
                strokeDasharray="2 2"
              />
              <text
                x={0}
                y={4}
                fontSize={8}
                fill="#EF4444"
                textAnchor="middle"
                fontFamily="system-ui, sans-serif"
              >
                ?
              </text>
            </g>
          );
        }

        return (
          <g
            key={re.element.id}
            data-element-id={re.element.id}
            transform={transformAttr(place, re.libraryDef)}
            className="ole-element"
          >
            <g dangerouslySetInnerHTML={{ __html: re.libraryDef.svg }} />
          </g>
        );
      })}
    </g>
  );
}

function transformAttr(p: ResolvedPlacement, lib: LibraryEntry | undefined): string {
  // Composition (SVG applies left-to-right, parent-frame first):
  //   translate(at) → rotate(rot) → scale(mirror?-1:1, 1) → stretch
  const parts = [`translate(${p.at[0]} ${p.at[1]})`];
  if (p.rot) parts.push(`rotate(${p.rot})`);
  if (p.mirror) parts.push(`scale(-1 1)`);

  // Stretchable elements (e.g. busbar): if `span` is set, scale the symbol
  // along its stretch axis so the visible geometry matches the requested
  // span. The reference length is the distance between the symbol's two
  // endpoint terminals along that axis.
  const stretch = lib?.stretchable;
  if (stretch && p.span && lib) {
    const ref = referenceLength(lib, stretch.axis);
    if (ref > 0) {
      const k = p.span / ref;
      parts.push(stretch.axis === 'x' ? `scale(${k} 1)` : `scale(1 ${k})`);
    }
  }
  return parts.join(' ');
}

function referenceLength(lib: LibraryEntry, axis: 'x' | 'y'): number {
  if (lib.terminals.length < 2) return 0;
  const vs = lib.terminals.map((t) => (axis === 'x' ? t.x : t.y));
  return Math.max(...vs) - Math.min(...vs);
}
