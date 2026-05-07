/**
 * DOM-based hit testing. The renderer tags every interactive node with a
 * `data-*` attribute (data-element-id, data-terminal-id, data-node-id) so
 * tools can locate the model they belong to without React state lookups.
 */

import { useEditorStore } from '@/store';
import type { ElementId, NodeId, TerminalRef } from '@/model';

function ancestor(target: EventTarget | null, attr: string): Element | null {
  if (!(target instanceof Element)) return null;
  return target.closest(`[${attr}]`);
}

export function hitElement(target: EventTarget | null): ElementId | null {
  return ancestor(target, 'data-element-id')?.getAttribute('data-element-id') ?? null;
}

/**
 * Returns the terminal under the cursor. Direct hit on a `data-terminal-id`
 * node wins; otherwise, if the click landed on a busbar element body, fall
 * back to that bus's virtual `tap` pin so the wire tool can attach anywhere
 * along the bus.
 */
export function hitTerminal(target: EventTarget | null): TerminalRef | null {
  const direct = ancestor(target, 'data-terminal-id')?.getAttribute('data-terminal-id');
  if (direct) return direct as TerminalRef;
  const elementId = hitElement(target);
  if (!elementId) return null;
  const re = useEditorStore.getState().internal.elements.get(elementId);
  if (re?.element.kind === 'busbar') {
    return `${elementId}.tap` as TerminalRef;
  }
  return null;
}

export function hitNode(target: EventTarget | null): NodeId | null {
  return ancestor(target, 'data-node-id')?.getAttribute('data-node-id') ?? null;
}
