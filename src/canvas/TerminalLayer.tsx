/**
 * Renders a `<circle>` per terminal at its world coords. Hidden by default;
 * the wire tool reveals them via the `.tool-wire` class on the canvas root.
 * In select mode, terminals on currently-selected elements are also revealed
 * so the user can grab one to drag-connect without switching tools.
 * `data-connected` distinguishes solid (connected) from hollow (dangling).
 *
 * Selected stretchable elements (e.g. busbar) get their terminals suppressed
 * here because `BusHandles` already draws a larger grip at the same world
 * coords — showing both produces visible "double" control points.
 */

import { useEditorStore } from '../store';

export function TerminalLayer() {
  const terminals = useEditorStore((s) => s.internal.terminals);
  const terminalToNode = useEditorStore((s) => s.internal.terminalToNode);
  const wireFrom = useEditorStore((s) => s.wireFromTerminal);
  const selection = useEditorStore((s) => s.selection);
  const internalElements = useEditorStore((s) => s.internal.elements);
  const activeTool = useEditorStore((s) => s.activeTool);

  // Element ids whose terminals are visually covered by BusHandles. We only
  // hide them when those handles are actually shown (select tool); the wire
  // tool needs every terminal visible for connection.
  const handlesCovered = new Set<string>();
  const selectionSet = new Set<string>();
  if (activeTool === 'select') {
    for (const id of selection) {
      selectionSet.add(id);
      const re = internalElements.get(id);
      if (re?.libraryDef?.stretchable) handlesCovered.add(id);
    }
  }

  return (
    <g className="ole-terminal-layer">
      {Array.from(terminals.values()).map((t) => {
        if (handlesCovered.has(t.elementId)) return null;
        // Bus's tap pin is a virtual "anywhere along the bus" terminal, not
        // a physical contact. Hide its center-of-bus circle; auto-route
        // projects each external terminal onto the bus axis instead.
        const re = internalElements.get(t.elementId);
        if (re?.element.kind === 'busbar') return null;
        const nodeId = terminalToNode.get(t.ref);
        const connected = nodeId !== undefined;
        const isOrigin = wireFrom === t.ref;
        const onSelected = selectionSet.has(t.elementId);
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
            data-on-selected={onSelected ? 'true' : undefined}
            className="ole-terminal"
          />
        );
      })}
    </g>
  );
}
