import { useEffect } from 'react';
import { CanvasSvg } from '../canvas';
import { ElementHoverLabel } from '../canvas/ElementHoverLabel';
import { ContextMenuHost } from './ContextMenu';
import { ContextualToolbar } from './ContextualToolbar';
import { FloatingToolbar } from './FloatingToolbar';
import { LeftPanel } from './LeftPanel';
import { LibraryPopover } from './LibraryPopover';
import { RightPanel } from './RightPanel';
import { ViewToolbar } from './ViewToolbar';

/**
 * Keep keyboard focus where shortcuts can reach it.
 *
 * Two failure modes this guards against:
 *   1. Clicking a chrome button leaves it focused → next Space press activates
 *      the button instead of starting a pan, etc. Fix: preventDefault on
 *      mousedown of chrome buttons so they never steal focus from the canvas.
 *   2. Tab navigation puts focus on a chrome button → user has no way to
 *      reset short of clicking. Fix: clicking the canvas blurs the active
 *      element, restoring the "no focus" baseline shortcuts expect.
 *
 * Tab still works for keyboard-only users who actually want to navigate the
 * chrome — only mouse interactions are made focus-neutral.
 */
function useFocusGuards() {
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      // Don't steal text selection or input focus.
      if (
        t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.isContentEditable
      ) {
        return;
      }
      const btn = t.closest('button');
      if (btn && btn.closest('.ole-glass')) e.preventDefault();
    };
    const onCanvasPointerDown = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (!t.closest('.ole-canvas-root')) return;
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body) return;
      // Leave inputs alone — clicking outside an input naturally blurs it
      // anyway, and we don't want to fight any deliberate focus.
      if (
        active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.isContentEditable
      ) {
        return;
      }
      active.blur();
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('pointerdown', onCanvasPointerDown, true);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('pointerdown', onCanvasPointerDown, true);
    };
  }, []);
}

export function EditorShell() {
  useFocusGuards();
  return (
    <ContextMenuHost>
      <div className="relative h-full w-full overflow-hidden bg-background text-foreground">
        <CanvasSvg />
        <LeftPanel />
        <RightPanel />
        <FloatingToolbar />
        <ViewToolbar />
        <ContextualToolbar />
        <LibraryPopover />
        <ElementHoverLabel />
      </div>
    </ContextMenuHost>
  );
}
