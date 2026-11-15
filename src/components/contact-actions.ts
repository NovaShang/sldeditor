/**
 * "Add contact": the menu entries that arm the place tool with another
 * contact of the selected device (-KM1 → its next NO is 23-24). Shared by the
 * right-click menu, the contextual toolbar button / C hotkey and the
 * property panel, so all three offer the same contacts with the same numbers.
 */

import type { LocaleKey } from '../i18n';
import { contactDeviceOf, contactOptions, nextContactPins } from '../lib/contact-numbers';
import { isCircuitDiagram } from '../model/diagram-type';
import type { ElementId } from '../model';
import { useEditorStore } from '../store';
import type { ContextMenuItem } from './ContextMenu';

type T = (key: LocaleKey, params?: Record<string, string | number>) => string;

/** The device `id` belongs to, when contacts can be added to it. */
export function addContactSource(id: ElementId | undefined): { tag: string } | null {
  if (!id) return null;
  const { diagram } = useEditorStore.getState();
  if (!isCircuitDiagram(diagram)) return null;
  const el = diagram.elements.find((e) => e.id === id);
  if (!el) return null;
  const device = contactDeviceOf(diagram, el);
  return device ? { tag: device.tag } : null;
}

/**
 * One entry per contact the device can take, each showing the terminal
 * numbers it will get. Empty when `id` is not part of such a device (or the
 * drawing is not a circuit diagram).
 */
export function addContactItems(t: T, id: ElementId | undefined): ContextMenuItem[] {
  const src = addContactSource(id);
  if (!src || !id) return [];
  const { diagram, internal } = useEditorStore.getState();
  const el = diagram.elements.find((e) => e.id === id)!;
  const { members } = contactDeviceOf(diagram, el)!;
  return contactOptions(members, src.tag).map((opt) => {
    const pins = nextContactPins(diagram, src.tag, opt.kind, undefined, internal.library);
    return {
      label: t(opt.labelKey, { tag: src.tag }),
      shortcut: pins ? Object.values(pins).join('-') : undefined,
      onSelect: () => useEditorStore.getState().armContact(id, opt.kind),
    };
  });
}
