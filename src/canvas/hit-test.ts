/**
 * DOM-based hit testing. The renderer tags every interactive node with a
 * `data-*` attribute (data-element-id, data-bus-id, data-terminal-id,
 * data-node-id, data-wire-id) so tools can locate the model they belong to
 * without React state lookups.
 */

import type {
  AnnotationId,
  BusId,
  ElementId,
  JunctionId,
  NodeId,
  TerminalRef,
  WireEnd,
  WireId,
} from '../model';

function ancestor(target: EventTarget | null, attr: string): Element | null {
  if (!(target instanceof Element)) return null;
  return target.closest(`[${attr}]`);
}

export function hitElement(target: EventTarget | null): ElementId | null {
  return ancestor(target, 'data-element-id')?.getAttribute('data-element-id') ?? null;
}

export function hitBus(target: EventTarget | null): BusId | null {
  return ancestor(target, 'data-bus-id')?.getAttribute('data-bus-id') ?? null;
}

export function hitJunction(target: EventTarget | null): JunctionId | null {
  return ancestor(target, 'data-junction-id')?.getAttribute('data-junction-id') ?? null;
}

/**
 * Returns the connectable WireEnd under the cursor — a device terminal ref
 * ("X.Y"), a bare bus id, or a bare junction id. Direct hit on a
 * `data-terminal-id` node wins; otherwise fall back to a junction dot or a bus
 * body so the wire tool can attach to any of them.
 */
export function hitTerminal(target: EventTarget | null): WireEnd | null {
  const direct = ancestor(target, 'data-terminal-id')?.getAttribute('data-terminal-id');
  if (direct) return direct as TerminalRef;
  const junctionId = hitJunction(target);
  if (junctionId) return junctionId;
  const busId = hitBus(target);
  if (busId) return busId;
  return null;
}

export function hitNode(target: EventTarget | null): NodeId | null {
  return ancestor(target, 'data-node-id')?.getAttribute('data-node-id') ?? null;
}

export function hitWire(target: EventTarget | null): WireId | null {
  return ancestor(target, 'data-wire-id')?.getAttribute('data-wire-id') ?? null;
}

export function hitAnnotation(target: EventTarget | null): AnnotationId | null {
  return (
    ancestor(target, 'data-annotation-id')?.getAttribute('data-annotation-id') ??
    null
  );
}
