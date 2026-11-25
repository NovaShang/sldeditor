/**
 * The sheet inspector's "Title-block fields" section: a checkbox per field
 * that hides it on every sheet, and a caption box that renames it — and the
 * value rows above follow, so a hidden field is not asked for and a renamed
 * one is asked for by its new name.
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
import { SheetInspector } from '../../src/components/SheetInspector';
import { useLocale } from '../../src/i18n';
import { useEditorStore } from '../../src/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const st = () => useEditorStore.getState();

beforeEach(() => {
  useLocale.setState({ locale: 'en' });
  st().setDiagram({
    version: '1',
    elements: [],
    sheets: [{ id: 'S1', paper: 'a4', orientation: 'landscape', at: [0, 0] }],
    meta: { titleBlock: { designer: 'GS' } },
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<SheetInspector sheetId="S1" />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const checkbox = (field: string) =>
  host.querySelector<HTMLInputElement>(`input[type="checkbox"][aria-label="Show “${field}” in the title block"]`);
const labels = () => [...host.querySelectorAll('label')].map((l) => l.textContent);

describe('title-block fields in the sheet inspector', () => {
  it('lists every field with a show box, all ticked by default', () => {
    for (const f of ['Project', 'Client', 'Title', 'Drawing no.', 'Designed', 'Checked', 'Date', 'Scale', 'Sheet']) {
      expect(checkbox(f)?.checked, f).toBe(true);
    }
  });

  it('unticking hides the field document-wide and drops its value row', () => {
    expect(labels().filter((l) => l === 'Designed')).toHaveLength(2); // value row + caption row
    act(() => checkbox('Designed')!.click());
    expect(st().diagram.meta?.titleBlock).toEqual({ designer: 'GS', hidden: ['designer'] });
    expect(labels().filter((l) => l === 'Designed')).toHaveLength(1);
    act(() => checkbox('Designed')!.click());
    expect(st().diagram.meta?.titleBlock).toEqual({ designer: 'GS' });
  });

  it('a renamed field is asked for by its new name', () => {
    act(() => st().updateTitleBlock({ labels: { designer: 'Elaborado por' } }));
    expect(labels()).toContain('Elaborado por');
    expect(checkbox('Elaborado por')).not.toBeNull();
  });
});
