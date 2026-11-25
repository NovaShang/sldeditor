/**
 * Property panel: a power rating is shown in the unit its canvas label uses
 * and can be typed in W / kW / MW (or VA / kVA / MVA); it is always stored in
 * the library's unit, and opening an existing drawing changes nothing.
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
import { useLocale } from '../../src/i18n';
import type { DiagramFile } from '../../src/model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const store = () => useEditorStore.getState();
let container: HTMLDivElement;
let root: Root;

async function open(d: DiagramFile, id: string) {
  await act(async () => {
    store().setDiagram(d);
    store().setSelection([id]);
  });
}

function unitSelect(): HTMLSelectElement {
  const s = document.querySelector<HTMLSelectElement>('select[aria-label="Unit"]');
  if (!s) throw new Error('no unit select');
  return s;
}
const valueInput = () => unitSelect().parentElement!.querySelector('input')!;

async function type(el: HTMLInputElement, text: string) {
  await act(async () => {
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    el.blur();
  });
}

async function pick(el: HTMLSelectElement, value: string) {
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const P = () => store().diagram.elements[0].params?.P;
const S = () => store().diagram.elements[0].params?.S;

beforeEach(async () => {
  localStorage.clear();
  useLocale.getState().setLocale('en');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<OneLineEditor />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const load = (P?: number): DiagramFile => ({
  version: '1',
  elements: [{ id: 'L1', kind: 'load', ...(P !== undefined ? { params: { P } } : {}) }],
  layout: { L1: { at: [0, 0] } },
});

describe('power rating field', () => {
  it('shows 0.006 MW as 6 kW without touching the stored value', async () => {
    await open(load(0.006), 'L1');
    expect(unitSelect().value).toBe('kW');
    expect(valueInput().value).toBe('6');
    expect([...unitSelect().options].map((o) => o.value)).toEqual(['W', 'kW', 'MW']);
    expect(P()).toBe(0.006);
    expect(store().past).toHaveLength(0);
  });

  it('stores a typed kW value in MW', async () => {
    await open(load(0.006), 'L1');
    await type(valueInput(), '7.5');
    expect(P()).toBe(0.0075);
  });

  it('switching the unit converts the shown number, not the value', async () => {
    await open(load(2), 'L1');
    expect(unitSelect().value).toBe('MW');
    await pick(unitSelect(), 'kW');
    expect(valueInput().value).toBe('2000');
    expect(P()).toBe(2);
  });

  it('takes a typed suffix', async () => {
    await open(load(), 'L1');
    await type(valueInput(), '500 W');
    expect(P()).toBe(0.0005);
    expect(unitSelect().value).toBe('W');
    expect(valueInput().value).toBe('500');
  });

  it('rejects a unit of another quantity', async () => {
    await open(load(1), 'L1');
    await type(valueInput(), '5 kV');
    expect(P()).toBe(1);
  });

  it('works for kVA / MVA ratings too', async () => {
    await open(
      {
        version: '1',
        elements: [{ id: 'T1', kind: 'transformer-2w', params: { S: 0.63 } }],
        layout: { T1: { at: [0, 0] } },
      },
      'T1',
    );
    expect(unitSelect().value).toBe('kVA');
    expect(valueInput().value).toBe('630');
    await type(valueInput(), '1000');
    expect(S()).toBe(1);
  });
});
