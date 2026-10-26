/**
 * Drawing sheets on the canvas, and how the pointer treats them.
 *
 * @vitest-environment jsdom
 *
 * The rule users asked for (2026-09/10 chats: "框选元件时整个图框也被一起选中"):
 * a sheet is picked by its border or title block only. The blank paper is
 * empty canvas — a click there marquees and deselects, so drawing inside a
 * sheet works as before — and a marquee never picks a sheet up. Dragging a
 * sheet carries what is drawn on it, in one `moveSheet`.
 *
 * jsdom has no layout or hit-testing, so gestures are driven straight into
 * SelectTool with the target a real browser would report.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The editor store persists to localStorage, which this jsdom lacks.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
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
  } as Storage;
});
import { FIT_CONTENT_SELECTOR } from '../../src/canvas/fit-to-content';
import { SheetLayer } from '../../src/canvas/SheetLayer';
import { hitSheet, sheetContentIds } from '../../src/canvas/sheet-hit';
import { SelectTool } from '../../src/canvas/tools/SelectTool';
import type { ToolContext } from '../../src/canvas/tools/types';
import { useKeyboardShortcuts } from '../../src/canvas/useKeyboardShortcuts';
import type { ViewportApi } from '../../src/canvas/useViewport';
import { useLocale } from '../../src/i18n';
import type { DiagramFile } from '../../src/model';
import { useEditorStore } from '../../src/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A4 landscape ≈ 1123 × 794 units.
const DIAGRAM: DiagramFile = {
  version: '1',
  elements: [
    { id: 'QF1', kind: 'breaker' },
    { id: 'QF2', kind: 'breaker' },
  ],
  layout: { QF1: { at: [300, 300] }, QF2: { at: [1500, 300] } },
  annotations: [{ id: 'A1', at: [400, 400], text: 'note' }],
  sheets: [
    { id: 'S1', paper: 'a4', orientation: 'landscape', at: [0, 0], title: 'Main board' },
    { id: 'S2', paper: 'a4', orientation: 'landscape', at: [1200, 0] },
  ],
  meta: { titleBlock: { project: 'Plant 7' } },
};

let host: HTMLDivElement;
let root: Root;
let ctx: ToolContext;

function Harness() {
  useKeyboardShortcuts();
  return (
    <svg>
      <SheetLayer />
    </svg>
  );
}

beforeEach(() => {
  useLocale.getState().setLocale('en');
  host = document.createElement('div');
  // Snap is on only when a `.ole-canvas-root` without `hide-grid` exists.
  host.className = 'ole-canvas-root';
  host.dataset.tool = 'select';
  // jsdom has no pointer capture.
  Object.assign(host, {
    setPointerCapture() {},
    releasePointerCapture() {},
    hasPointerCapture: () => false,
  });
  document.body.appendChild(host);
  ctx = {
    hostEl: host,
    viewport: { screenToSvg: (x: number, y: number) => [x, y] } as unknown as ViewportApi,
  };
  useEditorStore.getState().setDiagram(structuredClone(DIAGRAM));
  useEditorStore.getState().clearSelection();
  root = createRoot(host);
  act(() => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function pe(target: Element, x: number, y: number): PointerEvent {
  return {
    button: 0,
    pointerId: 1,
    clientX: x,
    clientY: y,
    shiftKey: false,
    altKey: false,
    target,
    preventDefault() {},
    stopPropagation() {},
  } as unknown as PointerEvent;
}

const group = (id: string) => host.querySelector(`[data-sheet-id="${id}"]`)!;
const borderHit = (id: string) => group(id).querySelector('.ole-sheet-hit')!;
const titleHit = (id: string) => group(id).querySelector('.ole-sheet-title-hit')!;
const svg = () => host.querySelector('svg')!;

describe('SheetLayer', () => {
  it('draws one tagged group per sheet with its title block text', () => {
    const groups = host.querySelectorAll('[data-sheet-id]');
    expect([...groups].map((g) => g.getAttribute('data-sheet-id'))).toEqual(['S1', 'S2']);
    const text = group('S1').textContent ?? '';
    expect(text).toContain('Main board');
    expect(text).toContain('Plant 7');
    expect(text).toContain('1 of 2');
    expect(group('S2').textContent).toContain('2 of 2');
    // Shared fields show on every page.
    expect(group('S2').textContent).toContain('Plant 7');
  });

  it('renders nothing without sheets', () => {
    act(() => useEditorStore.getState().setDiagram({ ...structuredClone(DIAGRAM), sheets: undefined }));
    expect(host.querySelector('.ole-sheet-layer')).toBeNull();
  });

  it('re-translates the title block when the locale changes', () => {
    expect(group('S1').textContent).toContain('Project');
    act(() => useLocale.getState().setLocale('zh'));
    expect(group('S1').textContent).toContain('项目名称');
    expect(group('S1').textContent).toContain('第 1 张 / 共 2 张');
  });

  it('marks the selected sheet and outlines it', () => {
    expect(group('S1').querySelector('.ole-sheet-halo')).toBeNull();
    act(() => useEditorStore.getState().setSelectedSheet('S1'));
    expect(group('S1').getAttribute('data-selected')).toBe('true');
    expect(group('S1').querySelector('.ole-sheet-halo')).not.toBeNull();
    expect(group('S2').getAttribute('data-selected')).toBeNull();
  });

  it('is matched by the fit selector once per sheet, as the whole group', () => {
    const fit = [...host.querySelectorAll(FIT_CONTENT_SELECTOR)];
    expect(fit).toEqual([group('S1'), group('S2')]);
  });
});

describe('hitSheet', () => {
  it('hits the border band and the title block', () => {
    expect(hitSheet(borderHit('S1'))).toBe('S1');
    expect(hitSheet(titleHit('S2'))).toBe('S2');
  });

  it('does not hit the visible geometry, the paper, or the canvas', () => {
    expect(hitSheet(group('S1').querySelector('.ole-sheet-border'))).toBeNull();
    expect(hitSheet(group('S1'))).toBeNull();
    expect(hitSheet(svg())).toBeNull();
    expect(hitSheet(null)).toBeNull();
  });
});

describe('SelectTool on sheets', () => {
  it('a click on the border selects the sheet and clears other selections', () => {
    useEditorStore.getState().setSelection(['QF1']);
    act(() => {
      SelectTool.onPointerDown!(pe(borderHit('S1'), 0, 10), ctx);
      SelectTool.onPointerUp!(pe(borderHit('S1'), 0, 10), ctx);
    });
    const s = useEditorStore.getState();
    expect(s.selectedSheet).toBe('S1');
    expect(s.selection).toEqual([]);
    // A plain click moves nothing.
    expect(s.diagram.sheets![0].at).toEqual([0, 0]);
  });

  it('dragging the title block moves the sheet and what is on it, grid-snapped', () => {
    const t = titleHit('S1');
    act(() => SelectTool.onPointerDown!(pe(t, 1000, 700), ctx));
    act(() => SelectTool.onPointerMove!(pe(t, 1057, 733), ctx));
    // Live preview on the frame itself.
    expect(group('S1').getAttribute('transform')).toBe('translate(60 30)');
    act(() => SelectTool.onPointerUp!(pe(t, 1057, 733), ctx));
    const s = useEditorStore.getState();
    expect(s.diagram.sheets!.find((x) => x.id === 'S1')!.at).toEqual([60, 30]);
    expect(s.diagram.sheets!.find((x) => x.id === 'S2')!.at).toEqual([1200, 0]);
    expect(s.internal.layout.get('QF1')!.at).toEqual([360, 330]);
    expect(s.internal.layout.get('QF2')!.at).toEqual([1500, 300]);
    expect(s.diagram.annotations![0].at).toEqual([460, 430]);
    expect(group('S1').getAttribute('transform')).toBeNull();
    // One undo entry restores the page and its contents together.
    act(() => useEditorStore.getState().undo());
    const u = useEditorStore.getState();
    expect(u.diagram.sheets![0].at).toEqual([0, 0]);
    expect(u.internal.layout.get('QF1')!.at).toEqual([300, 300]);
  });

  it('the blank paper is empty canvas: it deselects, and a marquee never picks a sheet', () => {
    act(() => useEditorStore.getState().setSelectedSheet('S1'));
    // jsdom reports the svg as the target, as a browser does for the
    // click-through paper.
    act(() => {
      SelectTool.onPointerDown!(pe(svg(), 100, 100), ctx);
      SelectTool.onPointerUp!(pe(svg(), 100, 100), ctx);
    });
    expect(useEditorStore.getState().selectedSheet).toBeNull();
    // Sweep the whole first sheet, frame and all.
    act(() => {
      SelectTool.onPointerDown!(pe(svg(), -50, -50), ctx);
      SelectTool.onPointerMove!(pe(svg(), 1150, 820), ctx);
      SelectTool.onPointerUp!(pe(svg(), 1150, 820), ctx);
    });
    const s = useEditorStore.getState();
    expect(s.selectedSheet).toBeNull();
    expect(s.selection).toEqual(['QF1']);
    expect(s.diagram.sheets![0].at).toEqual([0, 0]);
  });

  it('a pointer cancel drops the preview without moving anything', () => {
    const t = titleHit('S1');
    act(() => SelectTool.onPointerDown!(pe(t, 1000, 700), ctx));
    act(() => SelectTool.onPointerMove!(pe(t, 1100, 700), ctx));
    act(() => SelectTool.onPointerCancel!(pe(t, 1100, 700), ctx));
    expect(group('S1').getAttribute('transform')).toBeNull();
    expect(useEditorStore.getState().diagram.sheets![0].at).toEqual([0, 0]);
  });
});

describe('keyboard', () => {
  const key = (k: string) => act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: k })));

  it('Delete removes the selected sheet and keeps its contents', () => {
    act(() => useEditorStore.getState().setSelectedSheet('S1'));
    key('Delete');
    const s = useEditorStore.getState();
    expect(s.diagram.sheets!.map((x) => x.id)).toEqual(['S2']);
    expect(s.selectedSheet).toBeNull();
    expect(s.diagram.elements.map((e) => e.id)).toEqual(['QF1', 'QF2']);
    expect(s.diagram.annotations).toHaveLength(1);
  });

  it('Delete with elements selected still deletes the elements, not a sheet', () => {
    act(() => useEditorStore.getState().setSelection(['QF2']));
    key('Backspace');
    const s = useEditorStore.getState();
    expect(s.diagram.elements.map((e) => e.id)).toEqual(['QF1']);
    expect(s.diagram.sheets).toHaveLength(2);
  });

  it('Escape clears the sheet selection', () => {
    act(() => useEditorStore.getState().setSelectedSheet('S2'));
    key('Escape');
    expect(useEditorStore.getState().selectedSheet).toBeNull();
    expect(useEditorStore.getState().diagram.sheets).toHaveLength(2);
  });
});

describe('sheetContentIds', () => {
  it('previews exactly what moveSheet moves', () => {
    const st = useEditorStore.getState();
    const before = st.internal;
    const ids = sheetContentIds(st.diagram, before, st.diagram.sheets![0]);
    expect(ids).toEqual({ elements: ['QF1'], annotations: ['A1'] });
    act(() => st.moveSheet('S1', 20, 0));
    const after = useEditorStore.getState();
    const moved = [...before.layout.keys()].filter(
      (id) => after.internal.layout.get(id)!.at[0] !== before.layout.get(id)!.at[0],
    );
    expect(moved).toEqual(ids.elements);
    const movedAnn = after.diagram.annotations!
      .filter((a, i) => a.at[0] !== st.diagram.annotations![i].at[0])
      .map((a) => a.id);
    expect(movedAnn).toEqual(ids.annotations);
  });
});
