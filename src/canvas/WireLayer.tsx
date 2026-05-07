/**
 * Renders compiled routes. Each `InternalRoute` may contain multiple
 * polylines (e.g. one stub per external terminal on a bus node), so we emit
 * a `<polyline>` per path and tag every one with `data-node-id` for future
 * hit-testing / hover highlight.
 */

import { useEditorStore } from '@/store';

export function WireLayer() {
  const routes = useEditorStore((s) => s.internal.routes);

  return (
    <g className="ole-wire-layer" fill="none" stroke="black" strokeWidth={1}>
      {Array.from(routes.entries()).flatMap(([nodeId, route]) =>
        route.paths.map((path, i) => (
          <polyline
            key={`${nodeId}#${i}`}
            data-node-id={nodeId}
            data-manual={route.manual ? 'true' : undefined}
            className="ole-wire"
            points={path.map((p) => `${p[0]},${p[1]}`).join(' ')}
          />
        )),
      )}
    </g>
  );
}
