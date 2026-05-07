/**
 * DOM-based hit testing. The renderer tags every interactive node with a
 * `data-*` attribute (data-element-id, data-terminal-id, data-node-id) so
 * tools can locate the model they belong to without React state lookups.
 */

import type { ElementId, NodeId, TerminalRef } from '@/model';

function ancestor(target: EventTarget | null, attr: string): Element | null {
  if (!(target instanceof Element)) return null;
  return target.closest(`[${attr}]`);
}

export function hitElement(target: EventTarget | null): ElementId | null {
  return ancestor(target, 'data-element-id')?.getAttribute('data-element-id') ?? null;
}

export function hitTerminal(target: EventTarget | null): TerminalRef | null {
  const v = ancestor(target, 'data-terminal-id')?.getAttribute('data-terminal-id');
  return (v as TerminalRef | null) ?? null;
}

export function hitNode(target: EventTarget | null): NodeId | null {
  return ancestor(target, 'data-node-id')?.getAttribute('data-node-id') ?? null;
}
