/**
 * Cursor quick-insert: "/" opens a library search at the mouse; ↑/↓ + Enter
 * places the pick there. Search is the palette's own (every word, any order,
 * the drawing type's symbols only).
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return mem.size;
      },
      key: (i: number) => [...mem.keys()][i] ?? null,
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
      clear: () => {
        mem.clear();
      },
    } as Storage,
  });
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { OneLineEditor } from '../../src/OneLineEditor';
import { useEditorStore } from '../../src/store';
import { quickInsertEntries, useQuickInsert } from '../../src/components/quick-insert-state';
import { useLocale } from '../../src/i18n';
import type { DiagramFile } from '../../src/model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DIAGRAM: DiagramFile = {
  version: '1',
  meta: { diagramType: 'circuit' },
  elements: [],
  wires: [],
};

let container: HTMLDivElement;
let root: Root;
const store = () => useEditorStore.getState();

beforeEach(async () => {
  localStorage.clear();
  useLocale.getState().setLocale('en');
  store().setDiagram(structuredClone(DIAGRAM));
  store().setActiveTool('select');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<OneLineEditor />);
  });
});

afterEach(async () => {
  await act(async () => useQuickInsert.setState({ at: null }));
  await act(async () => root.unmount());
  container.remove();
});

async function key(target: EventTarget, k: string) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
}

async function type(el: HTMLInputElement, text: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const box = () => document.querySelector<HTMLInputElement>('.ole-quick-insert input');
const options = () => [...document.querySelectorAll('.ole-quick-insert [role="option"]')];

describe('quick insert', () => {
  it('"/" opens a search box, Enter places the best match', async () => {
    await key(window, '/');
    const input = box();
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    await type(input!, 'coil relay');
    expect(options()[0]?.getAttribute('data-kind')).toBe('relay-coil');
    await key(input!, 'Enter');
    expect(box()).toBeNull();
    const placed = store().diagram.elements;
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ kind: 'relay-coil', name: '-K1' });
    expect(store().selection).toEqual([placed[0].id]);
  });

  it('arrow keys move the pick; Esc closes without placing', async () => {
    await key(window, '/');
    await type(box()!, 'contact');
    const second = options()[1]?.getAttribute('data-kind');
    expect(second).toBeTruthy();
    await key(box()!, 'ArrowDown');
    expect(options()[1].getAttribute('aria-selected')).toBe('true');
    await key(box()!, 'Enter');
    expect(store().diagram.elements[0]?.kind).toBe(second);

    await key(window, '/');
    await key(box()!, 'Escape');
    expect(box()).toBeNull();
    expect(store().diagram.elements).toHaveLength(1);
  });

  it('typing "/" into a text field does not open it', async () => {
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    await key(field, '/');
    expect(box()).toBeNull();
    field.remove();
  });

  it('offers only the drawing type’s symbols', () => {
    const lib = store().internal.library;
    const circuit = quickInsertEntries(lib, 'circuit').map((e) => e.id);
    const sld = quickInsertEntries(lib, 'sld').map((e) => e.id);
    expect(circuit).toContain('contactor-3p');
    expect(sld).not.toContain('contactor-3p');
    expect(circuit).not.toContain('busbar');
  });
});
