/**
 * `onToolUse`: one event per drawing-tool activation, for host analytics.
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
import { useToolUseReporter, type ToolUseEvent } from '../../src/hooks/use-tool-use';
import { useEditorStore } from '../../src/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe(props: { onToolUse?: (e: ToolUseEvent) => void; readOnly?: boolean }) {
  useToolUseReporter(props.onToolUse, props.readOnly);
  return null;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    useEditorStore.getState().setDiagram({
      version: '1',
      meta: { diagramType: 'circuit' },
      elements: [],
    });
    useEditorStore.getState().setActiveTool('select');
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const tool = (t: Parameters<ReturnType<typeof useEditorStore.getState>['setActiveTool']>[0]) =>
  act(() => useEditorStore.getState().setActiveTool(t));

describe('onToolUse', () => {
  it('fires once per activation of a drawing tool, with the diagram type', () => {
    const seen: ToolUseEvent[] = [];
    act(() => root.render(<Probe onToolUse={(e) => seen.push(e)} />));
    tool('busbar');
    tool('busbar'); // already active — not a new activation
    tool('select'); // navigation — not reported
    tool('pan');
    tool('wire');
    tool('busbar'); // re-activation after another tool — reported again
    expect(seen).toEqual([
      { tool: 'busbar', diagramType: 'circuit' },
      { tool: 'wire', diagramType: 'circuit' },
      { tool: 'busbar', diagramType: 'circuit' },
    ]);
  });

  it('defaults the diagram type to sld', () => {
    act(() => useEditorStore.getState().setDiagram({ version: '1', elements: [] }));
    const seen: ToolUseEvent[] = [];
    act(() => root.render(<Probe onToolUse={(e) => seen.push(e)} />));
    tool('place');
    expect(seen).toEqual([{ tool: 'place', diagramType: 'sld' }]);
  });

  it('reports nothing in read-only mode', () => {
    const fn = vi.fn();
    act(() => root.render(<Probe onToolUse={fn} readOnly />));
    tool('wire');
    expect(fn).not.toHaveBeenCalled();
  });

  it('a throwing host callback does not break tool switching', () => {
    act(() =>
      root.render(
        <Probe
          onToolUse={() => {
            throw new Error('analytics down');
          }}
        />,
      ),
    );
    tool('text');
    expect(useEditorStore.getState().activeTool).toBe('text');
  });
});
