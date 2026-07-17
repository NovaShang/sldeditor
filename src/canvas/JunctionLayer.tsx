/**
 * Renders one `<circle>` per junction — a free-standing point connection node
 * (first-class peer to `Bus`). Tagged with `data-junction-id` so hit-test and
 * the wire tool can attach to it, and `data-node-id` so a click resolves to
 * the junction's electrical node, mirroring the bus/wire tagging convention.
 *
 * Following the schematic solder-dot convention, only *electrical* junctions —
 * where 3+ conductors meet (`degree >= 3`, tagged `data-solder`) — show a dot
 * at rest. Low-degree junctions (a corner or pass-through) stay hidden until
 * the user needs them: CSS reveals the dot on hover of the junction or a
 * connected wire, while a drawing/placing tool is active, or on selection.
 * The wider transparent hit circle keeps every junction clickable regardless.
 */

import { useEditorStore } from '../store';

const DOT_R = 2.5;
/** Wider invisible target for comfortable clicking, mirroring the bus hit-rect. */
const HIT_R = 9;
/** Wire-pull handle, shown on a solo-selected junction: drag it to start a wire
 *  from the junction (dragging the dot itself still moves the junction). Offset
 *  up-and-right of the dot so it never overlaps the move target. */
const WIRE_HANDLE_DX = 13;
const WIRE_HANDLE_DY = -13;
const WIRE_HANDLE_R = 4.5;
const WIRE_HANDLE_HIT_R = 8;

export function JunctionLayer() {
  const junctions = useEditorStore((s) => s.internal.junctions);
  const selection = useEditorStore((s) => s.selection);
  const selectedNode = useEditorStore((s) => s.selectedNode);
  const nodes = useEditorStore((s) => s.internal.nodes);
  const terminalToNode = useEditorStore((s) => s.internal.terminalToNode);
  const selSet = new Set(selection);

  const nodeRelated = new Set<string>();
  if (selectedNode) {
    const node = nodes.get(selectedNode);
    if (node) for (const end of node.terminals) nodeRelated.add(end);
  }

  return (
    <g className="ole-junction-layer">
      {Array.from(junctions.values()).map(({ junction, world, degree }) => {
        const nodeId = terminalToNode.get(junction.id) ?? undefined;
        const soloSelected = selection.length === 1 && selection[0] === junction.id;
        const hx = world[0] + WIRE_HANDLE_DX;
        const hy = world[1] + WIRE_HANDLE_DY;
        return (
          <g
            key={junction.id}
            data-junction-id={junction.id}
            data-element-id={junction.id}
            data-node-id={nodeId}
            data-solder={degree >= 3 ? 'true' : undefined}
            data-selected={selSet.has(junction.id) ? 'true' : undefined}
            data-node-related={nodeRelated.has(junction.id) ? 'true' : undefined}
            className="ole-junction"
          >
            <circle cx={world[0]} cy={world[1]} r={HIT_R} fill="transparent" className="ole-junction-hit" />
            <circle cx={world[0]} cy={world[1]} r={DOT_R} className="ole-junction-dot" />
            {soloSelected && (
              <g className="ole-junction-wire-handle-group">
                <line x1={world[0]} y1={world[1]} x2={hx} y2={hy} className="ole-junction-wire-handle-stem" />
                <circle cx={hx} cy={hy} r={WIRE_HANDLE_HIT_R} fill="transparent" className="ole-junction-wire-handle" />
                <circle cx={hx} cy={hy} r={WIRE_HANDLE_R} className="ole-junction-wire-handle-dot" />
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}
