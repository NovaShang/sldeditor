/**
 * Renders one polyline per Wire. Each polyline carries `data-wire-id` so
 * hit-test resolves to the specific wire (not the whole electrical node)
 * and `data-node-id` for "select-whole-node" affordances.
 *
 * Each visible wire is paired with a wider invisible hit polyline. A 1px
 * wire is too thin to comfortably click; the hit poly catches pointer
 * events within ~8px of the line and carries the same data attributes.
 */

import { useEditorStore } from '../store';

export function WireLayer() {
  const wireRenders = useEditorStore((s) => s.internal.wireRenders);
  const terminalToNode = useEditorStore((s) => s.internal.terminalToNode);
  const wires = useEditorStore((s) => s.diagram.wires);
  const selectedWire = useEditorStore((s) => s.selectedWire);
  const selectedNode = useEditorStore((s) => s.selectedNode);

  // Build a quick wireId → nodeId lookup so each rendered polyline knows
  // its containing electrical node.
  const wireToNode = new Map<string, string>();
  for (const w of wires ?? []) {
    const node = terminalToNode.get(w.ends[0]);
    if (node) wireToNode.set(w.id, node);
  }

  return (
    <g className="ole-wire-layer" fill="none" stroke="currentColor" strokeWidth={1}>
      {Array.from(wireRenders.values()).flatMap((r) => {
        const path = r.path;
        if (path.length < 2) return [];
        const points = path.map((p) => `${p[0]},${p[1]}`).join(' ');
        const nodeId = wireToNode.get(r.wireId);
        const isWireSelected = selectedWire === r.wireId;
        const isNodeSelected = selectedNode != null && selectedNode === nodeId;
        return [
          <polyline
            key={`hit-${r.wireId}`}
            data-wire-id={r.wireId}
            data-node-id={nodeId}
            className="ole-wire-hit"
            points={points}
          />,
          <polyline
            key={r.wireId}
            data-wire-id={r.wireId}
            data-node-id={nodeId}
            data-manual={r.userEdited ? 'true' : undefined}
            data-selected={isWireSelected || isNodeSelected ? 'true' : undefined}
            className="ole-wire"
            points={points}
          />,
        ];
      })}
    </g>
  );
}
