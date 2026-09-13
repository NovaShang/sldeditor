/**
 * Renders one `<g>` per element. The library SVG fragment is inlined verbatim
 * via `dangerouslySetInnerHTML` — the library JSON is build-time content
 * (see `scripts/build-element-library.mjs`), not user input.
 *
 * Each `<g>` carries `data-element-id` so tools can hit-test via
 * `event.target.closest('[data-element-id]')` without React state. Selection
 * state is reflected as `data-selected="true"` so CSS / overlays can react
 * without re-rendering this layer's children.
 *
 * To make every element comfortable to click — not just its thin strokes —
 * we paint an invisible `<rect>` covering the library's viewBox before the
 * symbol. `fill="transparent"` is hittable (unlike `none`); the visual lines
 * still draw on top because they're added after.
 */

import { useCanvasStore } from '../store';
import type { LibraryEntry } from '../model';
import { transformAttr } from './transform-attr';
import { inkClass } from '../lib/colors';
import { alarmAttr, qualityAttr, useRuntime } from '../runtime/runtime-context';

interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function parseViewBox(s: string): BBox | null {
  const parts = s.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
}

function HitRect({ lib }: { lib: LibraryEntry }) {
  const bb = parseViewBox(lib.viewBox);
  if (!bb) return null;
  return (
    <rect
      className="ole-element-hit"
      x={bb.x}
      y={bb.y}
      width={bb.w}
      height={bb.h}
    />
  );
}

export function ElementLayer() {
  const elements = useCanvasStore((s) => s.internal.elements);
  const layout = useCanvasStore((s) => s.internal.layout);
  const selection = useCanvasStore((s) => s.selection);
  const selectedNode = useCanvasStore((s) => s.selectedNode);
  const nodes = useCanvasStore((s) => s.internal.nodes);
  // Live data (viewer only — empty in the editor). Drives `data-alarm` /
  // `data-quality` for the stylesheet and hides `visible: false` symbols.
  const runtime = useRuntime().props;
  const selSet = new Set(selection);

  // Elements that have at least one terminal in the selected ConnectivityNode
  // get a halo to show "this is what the wire connects".
  const nodeRelated = new Set<string>();
  if (selectedNode) {
    const node = nodes.get(selectedNode);
    if (node) {
      for (const ref of node.terminals) {
        const dot = ref.indexOf('.');
        if (dot > 0) nodeRelated.add(ref.slice(0, dot));
      }
    }
  }

  return (
    <g className="ole-element-layer">
      {Array.from(elements.values()).map((re) => {
        const place = layout.get(re.element.id);
        if (!place) return null;
        const isSelected = selSet.has(re.element.id);
        const isNodeRelated = nodeRelated.has(re.element.id);
        const rt = runtime[re.element.id];
        if (rt?.visible === false) return null;

        if (!re.libraryDef) {
          // Unknown kind → small red placeholder square.
          return (
            <g
              key={re.element.id}
              data-element-id={re.element.id}
              data-selected={isSelected ? 'true' : undefined}
              data-node-related={isNodeRelated ? 'true' : undefined}
              transform={transformAttr(place)}
              className="ole-element ole-element--unknown"
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
            data-selected={isSelected ? 'true' : undefined}
            data-node-related={isNodeRelated ? 'true' : undefined}
            data-alarm={alarmAttr(rt)}
            data-quality={qualityAttr(rt)}
            transform={transformAttr(place)}
            /* The library SVG carries literal black; styles.css rewrites that
               to `currentColor`, so an ink class on this group recolours the
               whole symbol without touching a single element-library JSON. */
            className={
              inkClass(re.element.color)
                ? `ole-element ${inkClass(re.element.color)}`
                : 'ole-element'
            }
          >
            <HitRect lib={re.libraryDef} />
            <g dangerouslySetInnerHTML={{ __html: re.libraryDef.svg }} />
            {re.libraryDef.terminalLabelsSvg && (
              /* Pin digits — hidden unless wiring/selected (see styles.css). */
              <g
                className="ole-terminal-labels"
                dangerouslySetInnerHTML={{
                  __html: re.libraryDef.terminalLabelsSvg,
                }}
              />
            )}
          </g>
        );
      })}
    </g>
  );
}
