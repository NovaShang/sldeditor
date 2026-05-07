/**
 * Renders a `<circle>` per terminal at its world coords. Hidden by default;
 * the wire tool reveals them via the `.tool-wire` class on the canvas root.
 * `data-connected` distinguishes solid (connected) from hollow (dangling).
 */

import { useEditorStore } from '@/store';

export function TerminalLayer() {
  const terminals = useEditorStore((s) => s.internal.terminals);
  const terminalToNode = useEditorStore((s) => s.internal.terminalToNode);
  const wireFrom = useEditorStore((s) => s.wireFromTerminal);

  return (
    <g className="ole-terminal-layer">
      {Array.from(terminals.values()).map((t) => {
        const nodeId = terminalToNode.get(t.ref);
        const connected = nodeId !== undefined;
        const isOrigin = wireFrom === t.ref;
        return (
          <circle
            key={t.ref}
            cx={t.world[0]}
            cy={t.world[1]}
            r={3}
            data-element-id={t.elementId}
            data-terminal-id={t.ref}
            data-node-id={nodeId}
            data-connected={connected ? 'true' : 'false'}
            data-active={isOrigin ? 'true' : undefined}
            className="ole-terminal"
          />
        );
      })}
    </g>
  );
}
