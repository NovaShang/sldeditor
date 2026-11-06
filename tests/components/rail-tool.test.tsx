/**
 * Supply rails on a circuit diagram: the busbar tool is back there as the
 * Rail tool (button, B hotkey, hint, onboarding tip, property panel), the
 * rail inspector names and colours a rail in one click, and the single-line
 * wording is untouched. Plus: the column around the bottom toolbar lets
 * drags through to the canvas.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FloatingToolbar } from '../../src/components/FloatingToolbar';
import { OnboardingCard } from '../../src/components/OnboardingCard';
import { RightPanel } from '../../src/components/RightPanel';
import { useKeyboardShortcuts } from '../../src/canvas/useKeyboardShortcuts';
import { useLocale } from '../../src/i18n';
import { useOnboarding } from '../../src/hooks/use-onboarding';
import { useEditorStore } from '../../src/store';
import type { DiagramFile } from '../../src/model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function doc(circuit: boolean): DiagramFile {
  return {
    version: '1',
    meta: circuit ? { diagramType: 'circuit' } : undefined,
    elements: [],
    buses: [{ id: 'B1', layout: { at: [0, 0], span: 200 } }],
    wires: [],
  };
}

function Shortcuts() {
  useKeyboardShortcuts();
  return null;
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  useLocale.getState().setLocale('en');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function mount(d: DiagramFile, ui: React.ReactNode) {
  await act(async () => {
    useEditorStore.getState().setDiagram(d);
    useEditorStore.getState().setActiveTool('select');
  });
  await act(async () => root.render(ui));
}

const button = (label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

describe('Rail tool on a circuit diagram', () => {
  it('shows Rail (not Busbar), arms the bus tool and says "rail" in the hint', async () => {
    await mount(doc(true), <FloatingToolbar />);
    expect(button('Busbar')).toBeNull();
    const rail = button('Rail');
    expect(rail).not.toBeNull();
    expect(rail!.textContent).toContain('B');
    await act(async () => rail!.click());
    expect(useEditorStore.getState().activeTool).toBe('busbar');
    expect(container.textContent).toContain('drag to draw a supply rail');
    expect(container.textContent).not.toMatch(/\bbus/i);
  });

  it('B arms it from the keyboard', async () => {
    await mount(doc(true), <Shortcuts />);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }));
    });
    expect(useEditorStore.getState().activeTool).toBe('busbar');
  });

  it('keeps the single-line Busbar exactly as it was', async () => {
    await mount(doc(false), <FloatingToolbar />);
    expect(button('Rail')).toBeNull();
    await act(async () => button('Busbar')!.click());
    expect(useEditorStore.getState().activeTool).toBe('busbar');
    expect(container.textContent).toContain('Press on the canvas to set start');
  });

  it('wire and place hints say rail, not bus', async () => {
    await mount(doc(true), <FloatingToolbar />);
    await act(async () => useEditorStore.getState().setActiveTool('place', { placeKind: 'fuse' }));
    expect(container.textContent).toContain('drag from a terminal / rail');
    await act(async () => useEditorStore.getState().setActiveTool('select'));
    await mount(doc(false), <FloatingToolbar />);
    await act(async () => useEditorStore.getState().setActiveTool('place', { placeKind: 'fuse' }));
    expect(container.textContent).toContain('drag from a terminal / bus');
  });
});

describe('onboarding tip', () => {
  it('teaches rails on a circuit diagram and the busbar on a single-line one', async () => {
    useOnboarding.setState({ dismissed: false });
    await mount(doc(true), <OnboardingCard />);
    expect(container.textContent).toContain('Supply rails: L / N, +24V / 0V');
    expect(container.textContent).not.toMatch(/busbar/i);
    await mount(doc(false), <OnboardingCard />);
    expect(container.textContent).toContain('A busbar is a shared rail, not a wire');
  });
});

describe('rail inspector', () => {
  it('titles the rail and names + colours it from a preset in one undo step', async () => {
    await mount(doc(true), <RightPanel />);
    await act(async () => useEditorStore.getState().setSelection(['B1']));
    expect(container.textContent).toContain('Supply rail');
    expect(container.textContent).not.toMatch(/\bBus\b/);

    const past = useEditorStore.getState().past.length;
    await act(async () => button('PE · Green-yellow')!.click());
    let bus = useEditorStore.getState().diagram.buses![0];
    expect(bus).toMatchObject({ name: 'PE', color: 'green-yellow' });
    expect(useEditorStore.getState().past.length).toBe(past + 1);
    expect(button('PE · Green-yellow')!.getAttribute('aria-pressed')).toBe('true');

    // A control potential: name set, colour back to the default ink.
    await act(async () => button('+24V · Black')!.click());
    bus = useEditorStore.getState().diagram.buses![0];
    expect(bus.name).toBe('+24V');
    expect(bus.color).toBeUndefined();

    // Re-applying the active preset records nothing.
    const len = useEditorStore.getState().past.length;
    await act(async () => button('+24V · Black')!.click());
    expect(useEditorStore.getState().past.length).toBe(len);
  });

  it('offers every rail preset', async () => {
    await mount(doc(true), <RightPanel />);
    await act(async () => useEditorStore.getState().setSelection(['B1']));
    const chips = [...container.querySelectorAll('[role="group"] button')].map((b) => b.textContent);
    expect(chips).toEqual(['L1', 'L2', 'L3', 'N', 'PE', 'L', '+24V', '0V']);
  });

  it('a single-line bus is still a Bus, with no conductor presets', async () => {
    await mount(doc(false), <RightPanel />);
    await act(async () => useEditorStore.getState().setSelection(['B1']));
    expect(container.textContent).toContain('Bus');
    expect(container.querySelector('[role="group"]')).toBeNull();
  });
});

describe('bottom toolbar column', () => {
  it('only the bar takes the pointer; the hint and the column around it pass drags through', async () => {
    await mount(doc(true), <FloatingToolbar />);
    const column = container.firstElementChild as HTMLElement;
    expect(column.className).toContain('pointer-events-none');
    const bar = button('Rail')!.closest('.ole-glass.rounded-2xl') as HTMLElement;
    expect(bar.className).toContain('pointer-events-auto');
    // Every child of the column other than the bar (hint pill, notice) is
    // pointer-transparent, as is everything inside it.
    for (const child of [...column.children]) {
      if (child === bar) continue;
      expect((child as HTMLElement).className).toContain('pointer-events-none');
    }
  });
});
