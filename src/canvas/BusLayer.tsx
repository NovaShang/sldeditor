/**
 * Renders one `<g>` per bus. Each bus is a horizontal or vertical line
 * segment whose length is `geometry.span` and direction is given by
 * `geometry.axis` (x → horizontal, y → vertical). Tagged with `data-bus-id`
 * so hit-test can identify clicks on the bus body.
 */

import { useEditorStore } from '../store';

const STROKE_WIDTH = 3;
/** Invisible click target wider than the visible stroke, mirroring
 *  ElementLayer's `HitRect`. */
const HIT_WIDTH = 12;

export function BusLayer() {
  const buses = useEditorStore((s) => s.internal.buses);
  const selection = useEditorStore((s) => s.selection);
  const selectedNode = useEditorStore((s) => s.selectedNode);
  const nodes = useEditorStore((s) => s.internal.nodes);
  const terminalToNode = useEditorStore((s) => s.internal.terminalToNode);
  const selSet = new Set(selection);

  // Buses whose ConnectivityNode is selected get a halo.
  const nodeRelatedBuses = new Set<string>();
  if (selectedNode) {
    const node = nodes.get(selectedNode);
    if (node) {
      for (const end of node.terminals) {
        if (!end.includes('.')) nodeRelatedBuses.add(end);
      }
    }
  }

  return (
    <g className="ole-bus-layer">
      {Array.from(buses.values()).map(({ bus, geometry }) => {
        const { axis, at, span } = geometry;
        const half = span / 2;
        const x1 = axis === 'x' ? at[0] - half : at[0];
        const y1 = axis === 'x' ? at[1] : at[1] - half;
        const x2 = axis === 'x' ? at[0] + half : at[0];
        const y2 = axis === 'x' ? at[1] : at[1] + half;
        const isSelected = selSet.has(bus.id);
        const isNodeRelated = nodeRelatedBuses.has(bus.id);
        // Use the wire end's node id (if any) for `data-node-id` so a click
        // on the bus body resolves to its electrical node, mirroring the
        // wire layer's tagging convention.
        const nodeId = terminalToNode.get(bus.id) ?? undefined;
        // Wide invisible rect along the bus axis — gives a comfortable
        // click target without thickening the visible line.
        const hitHalf = HIT_WIDTH / 2;
        const hx = axis === 'x' ? at[0] - half : at[0] - hitHalf;
        const hy = axis === 'x' ? at[1] - hitHalf : at[1] - half;
        const hw = axis === 'x' ? span : HIT_WIDTH;
        const hh = axis === 'x' ? HIT_WIDTH : span;
        return (
          <g
            key={bus.id}
            data-bus-id={bus.id}
            data-element-id={bus.id}
            data-node-id={nodeId}
            data-selected={isSelected ? 'true' : undefined}
            data-node-related={isNodeRelated ? 'true' : undefined}
            className="ole-bus"
          >
            <rect
              x={hx}
              y={hy}
              width={hw}
              height={hh}
              fill="transparent"
              className="ole-bus-hit"
            />
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="black"
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
              fill="none"
            />
          </g>
        );
      })}
    </g>
  );
}
