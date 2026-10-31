/**
 * Diagram type helpers — the one place that turns the optional
 * `DiagramMeta.diagramType` into a decision. Every consumer (canvas, health
 * checks, palette, exports, hosts) asks here instead of reading the field, so
 * "absent means single-line" is written exactly once.
 */
import type { LibraryEntry } from './library';
import type { DiagramFile, DiagramType, Element } from './types';

export const DIAGRAM_TYPES: readonly DiagramType[] = ['sld', 'circuit'];

/** The document's drawing type; absent or unknown → `sld`. */
export function diagramTypeOf(d: Pick<DiagramFile, 'meta'> | null | undefined): DiagramType {
  return d?.meta?.diagramType === 'circuit' ? 'circuit' : 'sld';
}

export function isCircuitDiagram(d: Pick<DiagramFile, 'meta'> | null | undefined): boolean {
  return diagramTypeOf(d) === 'circuit';
}

/** Whether a library symbol belongs in this drawing type's palette / catalog. */
export function entryFitsDiagramType(entry: Pick<LibraryEntry, 'diagramTypes'>, type: DiagramType): boolean {
  return !entry.diagramTypes || entry.diagramTypes.length === 0 || entry.diagramTypes.includes(type);
}

/**
 * The pin designation shown next to one terminal of one placed element:
 * the instance override when present (an empty string hides it), else the
 * library default, else nothing.
 */
export function pinLabelOf(
  element: Pick<Element, 'pinLabels'>,
  entry: Pick<LibraryEntry, 'terminals'> | undefined,
  terminalId: string,
): string | undefined {
  const own = element.pinLabels?.[terminalId];
  if (own !== undefined) return own === '' ? undefined : own;
  return entry?.terminals.find((t) => t.id === terminalId)?.label || undefined;
}
