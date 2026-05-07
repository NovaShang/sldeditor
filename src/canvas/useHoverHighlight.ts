/**
 * Tracks which element / connectivity-node the cursor is over and toggles
 * marker classes on the affected DOM nodes. CSS reads those classes to
 * drive visual highlights without re-rendering React.
 *
 * Markers (added/removed by this hook):
 *   .ole-hover-element-host  — the element whose body the cursor is over;
 *                              its sibling terminals are also marked
 *   .ole-hover-terminal-on   — terminals belonging to the hovered element
 *                              (revealed regardless of tool, per ui-design §2.1)
 *   .ole-hover-node-on       — wires/terminals on the hovered ConnectivityNode
 *                              (highlighted, with non-members dimmed via root attr)
 */

import { useEffect, type RefObject } from 'react';
import { useEditorStore } from '@/store';
import { hitElement, hitNode, hitTerminal } from './hit-test';

const C_HOST = 'ole-hover-element-host';
const C_TERM = 'ole-hover-terminal-on';
const C_NODE = 'ole-hover-node-on';

export function useHoverHighlight(
  hostRef: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let lastElement: string | null = null;
    let lastNode: string | null = null;
    const markedTerminals = new Set<Element>();
    const markedNodeMembers = new Set<Element>();

    const clearAndMark = (
      pool: Set<Element>,
      next: Element[],
      cls: string,
    ) => {
      for (const el of pool) el.classList.remove(cls);
      pool.clear();
      for (const el of next) {
        el.classList.add(cls);
        pool.add(el);
      }
    };

    const updateElementHover = (id: string | null) => {
      if (id === lastElement) return;
      // Clear previous host class
      if (lastElement) {
        host
          .querySelector(`[data-element-id="${cssEscape(lastElement)}"]`)
          ?.classList.remove(C_HOST);
      }
      // Set new host class
      if (id) {
        host
          .querySelector(`[data-element-id="${cssEscape(id)}"]`)
          ?.classList.add(C_HOST);
      }
      // Mark terminals belonging to the hovered element
      const terms = id
        ? Array.from(
            host.querySelectorAll<SVGCircleElement>(
              `.ole-terminal[data-element-id="${cssEscape(id)}"]`,
            ),
          )
        : [];
      clearAndMark(markedTerminals, terms, C_TERM);
      lastElement = id;
      // Mirror to root attr so CSS can distinguish "any element hovered" state
      if (id) host.setAttribute('data-hover-element', '');
      else host.removeAttribute('data-hover-element');
    };

    const updateNodeHover = (nodeId: string | null) => {
      if (nodeId === lastNode) return;
      const members = nodeId
        ? Array.from(
            host.querySelectorAll<Element>(
              `[data-node-id="${cssEscape(nodeId)}"]`,
            ),
          )
        : [];
      clearAndMark(markedNodeMembers, members, C_NODE);
      lastNode = nodeId;
      if (nodeId) host.setAttribute('data-hover-node', '');
      else host.removeAttribute('data-hover-node');
    };

    const onPointerMove = (e: PointerEvent) => {
      updateElementHover(hitElement(e.target));

      const terminal = hitTerminal(e.target);
      let nodeId: string | null = null;
      if (terminal) {
        nodeId =
          useEditorStore.getState().internal.terminalToNode.get(terminal) ?? null;
      } else {
        nodeId = hitNode(e.target);
      }
      updateNodeHover(nodeId);
    };

    const onPointerLeave = () => {
      updateElementHover(null);
      updateNodeHover(null);
    };

    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerleave', onPointerLeave);
    return () => {
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerleave', onPointerLeave);
      updateElementHover(null);
      updateNodeHover(null);
    };
  }, [hostRef]);
}

function cssEscape(s: string): string {
  // Avoid CSS.escape (not always typed in lib.dom); IDs may contain dots.
  return s.replace(/(["\\])/g, '\\$1');
}
