import { useEffect, useRef } from 'react';
import { CanvasSvg } from '../canvas';
import { ElementHoverLabel } from '../canvas/ElementHoverLabel';
import { tierForWidth, useObservedWidth } from '../hooks/editor-tier';
import { BottomBarProvider } from '../hooks/bottom-bar-provider';
import { EditorTierProvider } from '../hooks/use-editor-tier';
import { useEditorStore } from '../store';
import { ContextMenuHost } from './ContextMenu';
import { ContextualToolbar } from './ContextualToolbar';
import { AnnotationEditToolbar } from './AnnotationEditToolbar';
import { FloatingToolbar } from './FloatingToolbar';
import { LeftPanel } from './LeftPanel';
import { LibraryPopover } from './LibraryPopover';
import { OnboardingCard } from './OnboardingCard';
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
 * Clicking the canvas also blurs a focused text field — the property panel's
 * Name box, the in-canvas name editor — and that one is load-bearing: their
 * onBlur is what commits the typed text. The canvas tools preventDefault
 * their pointerdown (drag, marquee, double-click), which cancels the
 * browser's own blur, so without this the field stayed focused, the click
 * changed the selection underneath it and the edit was thrown away. This
 * listener runs in the capture phase, i.e. before any tool, so the commit
 * lands on the object the field was editing, not the one just clicked.
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
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) {
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
      // A press inside the focused editor itself (the in-canvas editors live
      // in the canvas) is the user placing the caret, not leaving.
      if (active.contains(t)) return;
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
  const readOnly = useEditorStore((s) => s.readOnly);
  const rootRef = useRef<HTMLDivElement>(null);
  // Measured here (where the ref lives) so the layout effect runs *after*
  // this component's own ref attaches. A child component's layout effect
  // would fire before the parent's ref is set, so the first read is null.
  const width = useObservedWidth(rootRef);
  return (
    <ContextMenuHost>
      <div
        ref={rootRef}
        className="relative h-full w-full overflow-hidden bg-background text-foreground"
      >
        <EditorTierProvider width={width}>
          <BottomBarProvider width={width} tier={width == null ? 'full' : tierForWidth(width)}>
            <CanvasSvg />
            {readOnly ? (
              // View-only: canvas + zoom/fit controls + hover labels, no editing
              // chrome (panels, tools, contextual/library popovers, onboarding).
              <>
                <ViewToolbar />
                <ElementHoverLabel />
              </>
            ) : (
              <>
                <LeftPanel />
                <RightPanel />
                <FloatingToolbar />
                <ViewToolbar />
                <ContextualToolbar />
                <AnnotationEditToolbar />
                <LibraryPopover />
                <OnboardingCard />
                <ElementHoverLabel />
              </>
            )}
          </BottomBarProvider>
        </EditorTierProvider>
      </div>
    </ContextMenuHost>
  );
}
