/**
 * Typing a name must never be lost, leak into another element, or reach the
 * single-key shortcuts — the usability test's three ways of losing work:
 *
 *   - type a name in the panel, click the canvas to finish → text gone
 *     (canvas tools preventDefault pointerdown, so the field never blurred,
 *     then the selection changed under it);
 *   - the next element's Name box showed the previous one's draft;
 *   - a missed double-click on a thin contact sent "-KM1" to M (mirror),
 *     R (rotate) and Backspace (delete).
 *
 * @vitest-environment jsdom
 *
 * Mounted with `react-dom/client` + `act` (no testing-library here). jsdom
 * has no layout and no default focus-on-press, so the canvas presses below
 * test exactly what matters: that the editor itself commits on them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The store persists on every `set`; give it a memory localStorage before the
// store module is evaluated (`vi.hoisted` runs above the imports).
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
import type { DiagramFile } from '../../src/model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom implements neither; the name editor reads `innerText`.
if (!('innerText' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    get(this: HTMLElement) {
      return this.textContent ?? '';
    },
    set(this: HTMLElement, v: string) {
      this.textContent = v;
    },
  });
}

// …nor pointer capture, which the select tool takes on a canvas press.
for (const m of ['setPointerCapture', 'releasePointerCapture'] as const) {
  if (!(m in Element.prototype)) Object.assign(Element.prototype, { [m]: () => {} });
}
if (!('hasPointerCapture' in Element.prototype)) {
  Object.assign(Element.prototype, { hasPointerCapture: () => false });
}

const DIAGRAM: DiagramFile = {
  version: '1',
  meta: { diagramType: 'circuit' },
  elements: [
    { id: 'KA1', kind: 'relay-coil' },
    { id: 'KA2', kind: 'relay-coil' },
    { id: 'S1', kind: 'make-contact', name: '-S1' },
  ],
  layout: { KA1: { at: [0, 0] }, KA2: { at: [100, 0] }, S1: { at: [200, 0] } },
};

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  localStorage.clear();
  useEditorStore.getState().setDiagram(structuredClone(DIAGRAM));
  useEditorStore.getState().setActiveTool('select');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<OneLineEditor />);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const store = () => useEditorStore.getState();
const nameOf = (id: string) => store().diagram.elements.find((e) => e.id === id)?.name;

async function select(id: string) {
  await act(async () => store().setSelection([id]));
}

/** The property panel's Name box (the first textarea in the right panel). */
function nameBox(): HTMLTextAreaElement {
  const el = container.querySelector<HTMLTextAreaElement>('.ole-right-panel textarea');
  if (!el) throw new Error('no Name box');
  return el;
}

/** Focus + type the way React sees it (native setter, then `input`). */
async function typeInto(el: HTMLTextAreaElement, text: string) {
  await act(async () => {
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function key(target: EventTarget, k: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  });
}

/**
 * A canvas press as the select tool gets it: `pointerdown` that the tool
 * preventDefaults. jsdom has no PointerEvent, so a MouseEvent stands in —
 * the listeners only read button / coordinates / target.
 */
async function pressCanvas(target: Element) {
  await act(async () => {
    const Ctor = (window as { PointerEvent?: typeof MouseEvent }).PointerEvent ?? MouseEvent;
    target.dispatchEvent(new Ctor('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
    target.dispatchEvent(new Ctor('pointerup', { bubbles: true, cancelable: true, button: 0 }));
  });
}

const elementNode = (id: string) =>
  container.querySelector(`.ole-element-layer [data-element-id="${id}"]`)!;
const emptyCanvas = () => container.querySelector('.ole-canvas-svg > rect')!;

describe('property panel Name field', () => {
  it('commits when the user clicks the canvas to finish', async () => {
    await select('KA1');
    await typeInto(nameBox(), '-KA9');
    await pressCanvas(emptyCanvas());
    expect(nameOf('KA1')).toBe('-KA9');
  });

  it('commits to the element it was editing when the click selects another', async () => {
    await select('KA1');
    await typeInto(nameBox(), '-KA9');
    await pressCanvas(elementNode('S1'));
    expect(nameOf('KA1')).toBe('-KA9');
    expect(nameOf('S1')).toBe('-S1');
  });

  it('commits to the old element when the selection changes without a blur', async () => {
    await select('KA1');
    await typeInto(nameBox(), '-KA9');
    // Outline click / assistant edit: the field never loses focus.
    await select('S1');
    expect(nameOf('KA1')).toBe('-KA9');
    expect(nameOf('S1')).toBe('-S1');
    expect(nameBox().value).toBe('-S1');
  });

  it('never carries a draft over to the next element (equal stored values)', async () => {
    // KA1 and KA2 are both unnamed, so the Name box's `value` prop does not
    // change between them — the case that used to show "KM1↵KM1".
    await select('KA1');
    await typeInto(nameBox(), 'KM1');
    await select('KA2');
    expect(nameBox().value).toBe('');
    expect(nameOf('KA1')).toBe('KM1');
    expect(nameOf('KA2')).toBeUndefined();
  });

  it('Enter commits; Shift+Enter is a line break; Escape reverts', async () => {
    await select('KA1');
    const box = nameBox();
    await typeInto(box, '-KA9');
    await key(box, 'Enter', { shiftKey: true });
    expect(nameOf('KA1')).toBeUndefined();
    expect(document.activeElement).toBe(box);
    await key(box, 'Enter');
    expect(nameOf('KA1')).toBe('-KA9');
    expect(document.activeElement).not.toBe(box);

    await typeInto(nameBox(), 'oops');
    await key(nameBox(), 'Escape');
    expect(nameOf('KA1')).toBe('-KA9');
    expect(nameBox().value).toBe('-KA9');
  });

  it('keeps a stacked name typed with Shift+Enter', async () => {
    await select('KA1');
    await typeInto(nameBox(), 'QF1\n630A');
    await key(nameBox(), 'Enter');
    expect(nameOf('KA1')).toBe('QF1\n630A');
  });
});

describe('in-canvas name editor', () => {
  const editor = () =>
    container.querySelector<HTMLDivElement>('.ole-element-name-editor [contenteditable]');

  async function typeOnCanvas(text: string) {
    await act(async () => {
      const ed = editor()!;
      ed.textContent = text;
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('commits when the user clicks the canvas', async () => {
    await act(async () => store().setEditingElement('S1'));
    expect(document.activeElement).toBe(editor());
    await typeOnCanvas('-KM7');
    await pressCanvas(emptyCanvas());
    expect(nameOf('S1')).toBe('-KM7');
    expect(editor()).toBeNull();
  });

  it('a press inside the editor does not end the edit', async () => {
    await act(async () => store().setEditingElement('S1'));
    await typeOnCanvas('-KM7');
    await pressCanvas(editor()!);
    expect(editor()).not.toBeNull();
    expect(nameOf('S1')).toBe('-S1');
  });

  it('Enter commits, Escape cancels', async () => {
    await act(async () => store().setEditingElement('S1'));
    await typeOnCanvas('-KM7');
    await key(editor()!, 'Escape');
    expect(editor()).toBeNull();
    expect(nameOf('S1')).toBe('-S1');

    await act(async () => store().setEditingElement('S1'));
    await typeOnCanvas('-KM8');
    await key(editor()!, 'Enter');
    expect(editor()).toBeNull();
    expect(nameOf('S1')).toBe('-KM8');
  });

  it('keeps what was typed when closed from under it', async () => {
    await act(async () => store().setEditingElement('S1'));
    await typeOnCanvas('-KM7');
    await act(async () => store().clearSelection());
    expect(nameOf('S1')).toBe('-KM7');
  });

  it('opening and closing without typing leaves the name alone', async () => {
    const before = store().past.length;
    await act(async () => store().setEditingElement('S1'));
    await act(async () => store().clearSelection());
    expect(store().past.length).toBe(before);
  });
});

describe('single-key shortcuts while typing', () => {
  const placement = (id: string) => JSON.stringify(store().diagram.layout?.[id]);

  it('M / R / Backspace typed into the Name box do nothing to the drawing', async () => {
    await select('S1');
    const before = placement('S1');
    const box = nameBox();
    box.focus();
    for (const k of ['m', 'r', 'Backspace']) await key(box, k);
    expect(nameOf('S1')).toBe('-S1');
    expect(store().diagram.elements.some((e) => e.id === 'S1')).toBe(true);
    expect(placement('S1')).toBe(before);
  });

  it('are inert while an in-canvas editor is open, even if focus slipped out', async () => {
    await act(async () => store().setEditingElement('S1'));
    const before = placement('S1');
    // Not via blur (that commits and closes) — the editor is open, focus is
    // on <body>, and a key arrives.
    for (const k of ['m', 'r', 'Backspace']) await key(window, k);
    expect(store().diagram.elements.some((e) => e.id === 'S1')).toBe(true);
    expect(placement('S1')).toBe(before);
  });

  it('are inert during IME composition', async () => {
    await select('S1');
    const before = placement('S1');
    await key(window, 'm', { isComposing: true });
    expect(placement('S1')).toBe(before);
  });
});

describe('Esc from the hand tool', () => {
  it('returns to select', async () => {
    await act(async () => store().setActiveTool('pan'));
    await key(window, 'Escape');
    expect(store().activeTool).toBe('select');
  });
});

describe('thin-symbol hit area', () => {
  it('gives every symbol a screen-space hit band down its long axis', () => {
    const pad = elementNode('S1').querySelector('line.ole-element-hit-pad')!;
    expect(pad).not.toBeNull();
    expect(pad.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    // make-contact's box is 12 × 64: the band runs top to bottom, centred.
    expect(pad.getAttribute('x1')).toBe(pad.getAttribute('x2'));
    expect(pad.getAttribute('y1')).not.toBe(pad.getAttribute('y2'));
  });

  it('keeps the symbol DOM across re-renders (a press target must stay attached)', async () => {
    const stroke = elementNode('S1').querySelector(':scope > g > line')!;
    expect(stroke).not.toBeNull();
    await select('KA1');
    await act(async () => store().updateElement('KA2', { name: '-KA2' }));
    expect(stroke.isConnected).toBe(true);
  });
});
