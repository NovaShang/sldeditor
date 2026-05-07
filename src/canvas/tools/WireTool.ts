/**
 * Wire tool: click a terminal to start, click another terminal to commit.
 * Esc cancels (handled by the global keyboard hook).
 *
 * Activating the tool sets `.tool-wire` on the canvas root, which the CSS
 * uses to reveal terminals and turn on their pointer-events.
 */

import { useEditorStore } from '@/store';
import { hitTerminal } from '../hit-test';
import type { Tool } from './types';

export const WireTool: Tool = {
  id: 'wire',
  cursor: 'crosshair',

  onActivate(ctx) {
    ctx.hostEl.classList.add('tool-wire');
  },
  onDeactivate(ctx) {
    ctx.hostEl.classList.remove('tool-wire');
    useEditorStore.getState().setWireFromTerminal(null);
  },

  onPointerDown(e) {
    if (e.button !== 0) return;
    const ref = hitTerminal(e.target);
    if (!ref) {
      // Click on empty space cancels the in-progress wire.
      useEditorStore.getState().setWireFromTerminal(null);
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    const store = useEditorStore.getState();
    const from = store.wireFromTerminal;
    if (!from) {
      store.setWireFromTerminal(ref);
      return;
    }
    if (from === ref) return;
    store.addConnection(from, ref);
    store.setWireFromTerminal(null);
  },

  onPointerMove(e, ctx) {
    const sf = useEditorStore.getState().wireFromTerminal;
    if (!sf) return;
    const pt = ctx.viewport.screenToSvg(e.clientX, e.clientY);
    useEditorStore.getState().setCursorSvg(pt);
  },

  onPointerLeave() {
    useEditorStore.getState().setCursorSvg(null);
  },
};
