/**
 * Renders one `<circle>` per junction — a free-standing point connection node
 * (first-class peer to `Bus`). Tagged with `data-junction-id` so hit-test and
 * the wire tool can attach to it, and `data-node-id` so a click resolves to
 * the junction's electrical node, mirroring the bus/wire tagging convention.
 *
 * Junctions are always visible (unlike device terminals, which the wire tool
 * reveals on demand) because they are model objects the user placed, not
 * transient pins.
 */

import { useEditorStore } from '../store';

const DOT_R = 4;
/** Wider invisible target for comfortable clicking, mirroring the bus hit-rect. */
const HIT_R = 9;

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
      {Array.from(junctions.values()).map(({ junction, world }) => {
        const nodeId = terminalToNode.get(junction.id) ?? undefined;
        return (
          <g
            key={junction.id}
            data-junction-id={junction.id}
            data-element-id={junction.id}
            data-node-id={nodeId}
            data-selected={selSet.has(junction.id) ? 'true' : undefined}
            data-node-related={nodeRelated.has(junction.id) ? 'true' : undefined}
            className="ole-junction"
          >
            <circle cx={world[0]} cy={world[1]} r={HIT_R} fill="transparent" className="ole-junction-hit" />
            <circle cx={world[0]} cy={world[1]} r={DOT_R} className="ole-junction-dot" />
          </g>
        );
      })}
    </g>
  );
}
