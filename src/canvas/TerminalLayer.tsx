/**
 * Renders a `<circle>` for every terminal at its world coords. Default
 * styling is `display: none`; CSS will reveal them when a future "wire" tool
 * is active or when an element is hovered. Solid fill = connected; hollow =
 * dangling.
 */

import { useEditorStore } from '@/store';

export function TerminalLayer() {
  const terminals = useEditorStore((s) => s.internal.terminals);
  const terminalToNode = useEditorStore((s) => s.internal.terminalToNode);

  return (
    <g className="ole-terminal-layer">
      {Array.from(terminals.values()).map((t) => {
        const connected = terminalToNode.has(t.ref);
        return (
          <circle
            key={t.ref}
            cx={t.world[0]}
            cy={t.world[1]}
            r={3}
            data-element-id={t.elementId}
            data-terminal-id={t.ref}
            data-connected={connected ? 'true' : 'false'}
            className="ole-terminal"
          />
        );
      })}
    </g>
  );
}
