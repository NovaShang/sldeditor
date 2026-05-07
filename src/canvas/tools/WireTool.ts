/**
 * Wire tool: press on a terminal, drag to another terminal, release to commit.
 * Releasing on empty space (or the same terminal) cancels. Esc also cancels
 * via the global keyboard hook.
 *
 * Activating the tool sets `.tool-wire` on the canvas root, which the CSS
 * uses to reveal terminals and turn on their pointer-events so the drag-end
 * hit-test resolves to a terminal.
 *
 * During the drag we publish the *current* candidate target via
 * `wire-target-bus`; `WirePreview` paints a marker so the user sees where a
 * release would land — including the bus virtual-tap projection when the
 * cursor is over a bus body.
 */

import { useEditorStore } from '@/store';
import { hitTerminal } from '../hit-test';
import { resolveWireTarget } from '../resolve-wire-target';
import { publishWireTarget } from '../wire-target-bus';
import type { Tool } from './types';

export const WireTool: Tool = {
  id: 'wire',
  cursor: 'crosshair',

  onActivate(ctx) {
    ctx.hostEl.classList.add('tool-wire');
  },
  onDeactivate(ctx) {
    ctx.hostEl.classList.remove('tool-wire');
    const store = useEditorStore.getState();
    store.setWireFromTerminal(null);
    store.setCursorSvg(null);
    publishWireTarget(null);
  },

  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    const ref = hitTerminal(e.target);
    if (!ref) return;
    e.preventDefault();
    e.stopPropagation();

    // Touch pointers get implicit capture on pointerdown — release it so the
    // pointerup hit-test resolves to the terminal under the finger, not the
    // origin terminal.
    if (e.target instanceof Element && e.target.hasPointerCapture?.(e.pointerId)) {
      e.target.releasePointerCapture(e.pointerId);
    }

    const store = useEditorStore.getState();
    store.setWireFromTerminal(ref);
    store.setCursorSvg(ctx.viewport.screenToSvg(e.clientX, e.clientY));
  },

  onPointerMove(e, ctx) {
    const sf = useEditorStore.getState().wireFromTerminal;
    if (!sf) return;
    const pt = ctx.viewport.screenToSvg(e.clientX, e.clientY);
    useEditorStore.getState().setCursorSvg(pt);

    // Pointer capture pins `e.target` to the start terminal — sample what's
    // *actually* under the cursor instead.
    const under =
      typeof document !== 'undefined'
        ? document.elementFromPoint(e.clientX, e.clientY)
        : null;
    const ref = under ? hitTerminal(under) : null;
    if (!ref || ref === sf) {
      publishWireTarget(null);
      return;
    }
    publishWireTarget(resolveWireTarget(ref, pt));
  },

  onPointerUp(e) {
    const store = useEditorStore.getState();
    const from = store.wireFromTerminal;
    if (!from) return;
    store.setWireFromTerminal(null);
    store.setCursorSvg(null);
    publishWireTarget(null);

    const ref = hitTerminal(e.target);
    if (!ref || ref === from) return;
    store.addConnection(from, ref);
  },

  onPointerLeave() {
    const store = useEditorStore.getState();
    store.setWireFromTerminal(null);
    store.setCursorSvg(null);
    publishWireTarget(null);
  },
};
