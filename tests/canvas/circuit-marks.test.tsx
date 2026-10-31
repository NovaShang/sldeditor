/**
 * Canvas side of the circuit-diagram marks: the layers render pin
 * designations, extra solder dots and PE stripes on a circuit diagram, drop
 * the library's own pin-digit glyphs there, and change nothing on a
 * single-line one. Mounted through `<OneLineViewer>` (same canvas layers as
 * the editor, no chrome).
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { OneLineViewer } from '../../src/OneLineViewer';
import { createStaticTagSource } from '../../src/runtime/tag-source';
import type { DiagramFile } from '../../src/model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function doc(circuit: boolean): DiagramFile {
  return {
    version: '1',
    meta: circuit ? { diagramType: 'circuit' } : undefined,
    elements: [
      // The breaker ships pin-digit glyphs (terminalLabelsSvg).
      { id: 'QF1', kind: 'breaker', name: '-QF1', pinLabels: { t1: '1', t2: '2' } },
      { id: 'S1', kind: 'make-contact', pinLabels: { t1: '13', t2: '14' } },
      { id: 'S2', kind: 'make-contact', pinLabels: { t1: '23', t2: '24' } },
    ],
    buses: [{ id: 'L', name: 'L', layout: { at: [100, 0], span: 200 } }],
    wires: [
      { id: 'w1', ends: ['L', 'QF1.t1'] },
      { id: 'w2', ends: ['QF1.t2', 'S1.t1'] },
      { id: 'w3', ends: ['QF1.t2', 'S2.t1'], color: 'green-yellow' },
    ],
    layout: { QF1: { at: [60, 60] }, S1: { at: [40, 160] }, S2: { at: [80, 160] } },
  };
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function mount(d: DiagramFile) {
  await act(async () => {
    root.render(<OneLineViewer diagram={d} tags={createStaticTagSource({})} />);
  });
}

describe('circuit marks on the canvas', () => {
  it('draws designations, solder dots and PE stripes on a circuit diagram', async () => {
    await mount(doc(true));
    const pins = [...container.querySelectorAll('[data-pin-label]')].map((n) => n.textContent);
    expect(pins.sort()).toEqual(['1', '13', '14', '2', '23', '24']);
    // T at QF1.t2 (two wires) → one extra dot; the bus tap of w1 → another.
    expect(container.querySelectorAll('.ole-solder-dot').length).toBe(2);
    expect(container.querySelectorAll('.ole-pe-stripe').length).toBe(1);
    // No duplicate digits from the library glyph layer.
    expect(container.querySelector('.ole-terminal-labels')).toBeNull();
  });

  it('draws none of it on a single-line diagram', async () => {
    await mount({ ...doc(false), wires: doc(false).wires!.map(({ color: _c, ...w }) => w) });
    expect(container.querySelector('[data-pin-label]')).toBeNull();
    expect(container.querySelector('.ole-solder-dot')).toBeNull();
    expect(container.querySelector('.ole-pe-stripe')).toBeNull();
    expect(container.querySelector('.ole-terminal-labels')).not.toBeNull();
  });
});
