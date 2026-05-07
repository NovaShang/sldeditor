/**
 * Renders compiled routes. Each `InternalRoute` may contain multiple
 * polylines (e.g. one stub per external terminal on a bus node), so we emit
 * a `<polyline>` per path and tag every one with `data-node-id` for hit-test
 * / hover / selection highlight.
 *
 * Each visible wire is paired with a wider invisible hit polyline. A 1px
 * wire is too thin to comfortably click; the hit poly catches pointer events
 * within ~8px of the line and still carries the same `data-node-id` so
 * closest('[data-node-id]') resolves correctly.
 */

import { useEditorStore } from '@/store';

export function WireLayer() {
  const routes = useEditorStore((s) => s.internal.routes);
  const selectedNode = useEditorStore((s) => s.selectedNode);

  return (
    <g className="ole-wire-layer" fill="none" stroke="currentColor" strokeWidth={1}>
      {Array.from(routes.entries()).flatMap(([nodeId, route]) =>
        route.paths.flatMap((path, i) => {
          if (path.length < 2) return [];
          const points = path.map((p) => `${p[0]},${p[1]}`).join(' ');
          return [
            <polyline
              key={`hit-${nodeId}#${i}`}
              data-node-id={nodeId}
              className="ole-wire-hit"
              points={points}
            />,
            <polyline
              key={`${nodeId}#${i}`}
              data-node-id={nodeId}
              data-manual={route.manual ? 'true' : undefined}
              data-selected={selectedNode === nodeId ? 'true' : undefined}
              className="ole-wire"
              points={points}
            />,
          ];
        }),
      )}
    </g>
  );
}
