/**
 * `<OneLineViewer>` render smoke test — the same canvas layers the editor
 * uses, driven by a private store and a `RuntimeContext` snapshot.
 *
 * @vitest-environment jsdom
 *
 * No testing-library in this repo, so the tree is mounted with
 * `react-dom/client` and driven through `act`. jsdom has no layout, so the
 * assertions are about the DOM the layers emit (attributes, text), not pixels.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { OneLineViewer, type OneLineViewerApi } from '../../src/OneLineViewer';
import { createStaticTagSource } from '../../src/runtime/tag-source';
import type { DiagramFile } from '../../src/model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DIAGRAM: DiagramFile = {
  version: '1',
  elements: [
    { id: 'QF1', kind: 'breaker', name: '101' },
    { id: 'QF2', kind: 'breaker', name: '102' },
    { id: 'L1', kind: 'load', name: '馈线1' },
  ],
  buses: [{ id: 'B1', layout: { at: [0, 0], span: 300 } }],
  layout: { QF1: { at: [-100, 80] }, QF2: { at: [0, 80] }, L1: { at: [100, 80] } },
  wires: [
    { id: 'w1', ends: ['B1', 'QF1.t1'] },
    { id: 'w2', ends: ['B1', 'QF2.t1'] },
    { id: 'w3', ends: ['B1', 'L1.t_top'] },
  ],
  tags: [{ path: 'QF1/I', type: 'float', unit: 'A' }],
  bindings: [
    {
      target: 'QF1',
      prop: 'alarm',
      tag: 'QF1/h',
      mapping: {
        type: 'discrete',
        cases: [{ when: 'critical', out: 'fault' }],
        default: 'none',
      },
    },
    { target: 'QF1', prop: 'badge', tag: 'QF1/badge' },
    { target: 'QF1', prop: 'value', tag: 'QF1/I' },
    { target: 'QF2', prop: 'value', tag: 'QF2/I' },
    { target: 'QF2', prop: 'label.text', tag: 'QF2/label' },
    { target: 'L1', prop: 'visible', tag: 'L1/vis' },
  ],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

const q = (sel: string) => container.querySelector(sel);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('OneLineViewer', () => {
  it('renders the diagram through the shared layers and applies bindings', async () => {
    const tags = createStaticTagSource({
      'QF1/h': 'critical',
      'QF1/badge': '火警',
      'QF1/I': 12.5,
      'QF2/I': { v: 3, q: 'stale' },
      'QF2/label': '102 (检修)',
      'L1/vis': false,
    });
    await act(async () => {
      root.render(<OneLineViewer diagram={DIAGRAM} tags={tags} />);
    });

    // Root + canvas, no editor chrome.
    expect(q('.ole-root.ole-viewer')).not.toBeNull();
    expect(q('.ole-canvas-root')).not.toBeNull();
    expect(q('.ole-glass')).toBeNull();

    // Alarm on the symbol AND the wire leaving it.
    expect(q('.ole-element[data-element-id="QF1"]')?.getAttribute('data-alarm')).toBe('fault');
    expect(q('.ole-wire[data-wire-id="w1"]')?.getAttribute('data-alarm')).toBe('fault');
    expect(q('.ole-wire[data-wire-id="w2"]')?.getAttribute('data-alarm')).toBeNull();

    // Badge + value with the tag's unit.
    const rt1 = q('.ole-rt[data-rt-for="QF1"]');
    expect(rt1?.querySelector('.ole-rt-badge-text')?.textContent).toBe('火警');
    expect(rt1?.querySelector('.ole-rt-value')?.textContent).toBe('12.5 A');

    // Stale → greyed + `?`; value still shown (last known), no unit declared.
    expect(q('.ole-element[data-element-id="QF2"]')?.getAttribute('data-quality')).toBe('stale');
    const rt2 = q('.ole-rt[data-rt-for="QF2"]');
    expect(rt2?.querySelector('.ole-rt-quality-text')?.textContent).toBe('?');
    expect(rt2?.querySelector('.ole-rt-value')?.textContent).toBe('3');

    // label.text override replaces the structural label.
    expect(q('[data-element-label="QF2"]')?.textContent).toBe('102 (检修)');
    expect(q('[data-element-label="QF1"]')?.textContent).toBe('101');

    // visible:false hides the symbol and its label.
    expect(q('.ole-element[data-element-id="L1"]')).toBeNull();
    expect(q('[data-element-label="L1"]')).toBeNull();
  });

  it('batches tag updates (100ms) and clears the alarm when it goes back to normal', async () => {
    const tags = createStaticTagSource({ 'QF1/h': 'critical' });
    await act(async () => {
      root.render(<OneLineViewer diagram={DIAGRAM} tags={tags} />);
    });
    expect(q('.ole-element[data-element-id="QF1"]')?.getAttribute('data-alarm')).toBe('fault');

    await act(async () => {
      tags.set('QF1/h', 'normal');
      tags.set('QF1/badge', 'x');
    });
    // Not yet — still inside the throttle window.
    expect(q('.ole-element[data-element-id="QF1"]')?.getAttribute('data-alarm')).toBe('fault');
    await act(async () => {
      await sleep(150);
    });
    expect(q('.ole-element[data-element-id="QF1"]')?.getAttribute('data-alarm')).toBeNull();
    expect(q('.ole-rt[data-rt-for="QF1"] .ole-rt-badge-text')?.textContent).toBe('x');
  });

  it('reports clicks, honours controlled selection and hands out the api', async () => {
    const onElementClick = vi.fn();
    const onBackgroundClick = vi.fn();
    let api: OneLineViewerApi | null = null;
    await act(async () => {
      root.render(
        <OneLineViewer
          diagram={DIAGRAM}
          selectedIds={['QF2']}
          onElementClick={onElementClick}
          onBackgroundClick={onBackgroundClick}
          onReady={(a) => {
            api = a;
          }}
        />,
      );
    });
    expect(api).not.toBeNull();
    expect(q('.ole-element[data-element-id="QF2"]')?.getAttribute('data-selected')).toBe('true');
    expect(q('.ole-selection-rect')).not.toBeNull();

    await act(async () => {
      q('.ole-element[data-element-id="QF1"] .ole-element-hit')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expect(onElementClick).toHaveBeenCalledTimes(1);
    expect(onElementClick.mock.calls[0][0]).toBe('QF1');

    await act(async () => {
      q('.ole-canvas-svg')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onBackgroundClick).toHaveBeenCalledTimes(1);

    // Controlled: api.select is a no-op; the prop still rules.
    await act(async () => {
      api!.select(['QF1']);
    });
    expect(q('.ole-element[data-element-id="QF2"]')?.getAttribute('data-selected')).toBe('true');
    expect(q('.ole-element[data-element-id="QF1"]')?.getAttribute('data-selected')).toBeNull();
    // fit/focus do not throw without layout.
    api!.fit();
    api!.focus('QF1');
  });

  it('uncontrolled: api.select drives the selection; dark theme stays on its own root', async () => {
    let api: OneLineViewerApi | null = null;
    await act(async () => {
      root.render(
        <OneLineViewer
          diagram={DIAGRAM}
          theme="dark"
          onReady={(a) => {
            api = a;
          }}
        />,
      );
    });
    await act(async () => {
      api!.select(['B1']);
    });
    expect(q('.ole-bus[data-bus-id="B1"]')?.getAttribute('data-selected')).toBe('true');
    expect(q('.ole-root.ole-viewer')?.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
