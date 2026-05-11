/**
 * Top-level canvas SVG. Owns the pan/zoom viewport `<g>`, the static grid
 * background, and the active-tool dispatcher. Layers (wires, elements,
 * selection, terminals, previews) are children of the viewport so they
 * pan/zoom together.
 *
 * Z-order (back to front): grid → wires → elements → selection → terminals
 * → wire preview → place ghost.
 */

import { useCallback, useEffect, useRef } from 'react';
import {
  BoxSelect,
  Clipboard,
  Copy,
  FlipHorizontal,
  Redo2,
  RotateCw,
  Scissors,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useContextMenu, type ContextMenuEntry } from '../components/ContextMenu';
import { useT } from '../i18n';
import { useEditorStore } from '../store';
import { setViewportApi } from './viewport-bus';
import { dropElement } from './drop-on-bus';
import { AnnotationLayer } from './AnnotationLayer';
import { FreeAnnotationLayer } from './FreeAnnotationLayer';
import { BusHandles } from './BusHandles';
import { BusbarPreview } from './BusbarPreview';
import { ElementLayer } from './ElementLayer';
import { MarqueeOverlay } from './MarqueeOverlay';
import { PlaceGhost } from './PlaceGhost';
import { SelectionOverlay } from './SelectionOverlay';
import { TerminalLayer } from './TerminalLayer';
import { WireLayer } from './WireLayer';
import { WirePreview } from './WirePreview';
import { hitElement, hitNode } from './hit-test';
import { dispatchSyntheticPointerCancel } from './synthetic-pointer-cancel';
import { exitDrawingState } from './useKeyboardShortcuts';
import { useHoverHighlight } from './useHoverHighlight';
import { useTools } from './useTools';
import { useViewport } from './useViewport';

const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iP(ad|hone|od)/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl+';
const SHIFT = IS_MAC ? '⇧' : 'Shift+';

/**
 * Pick a world-space grid step (in snap units) so the rendered tile is at
 * least ~18 screen px. Steps are multiples of the snap step (10) along a
 * 1-2-5 series so every dot still lands on a snappable position.
 */
const GRID_STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
const MIN_SCREEN_STEP = 18;
function pickGridStep(scale: number): number {
  for (const w of GRID_STEPS) {
    if (w * scale >= MIN_SCREEN_STEP) return w;
  }
  return GRID_STEPS[GRID_STEPS.length - 1];
}

export function CanvasSvg() {
  const t = useT();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const groupRef = useRef<SVGGElement | null>(null);
  const gridPatternRef = useRef<SVGPatternElement | null>(null);
  const viewport = useViewport(hostRef, groupRef);
  useTools(hostRef, viewport);
  useHoverHighlight(hostRef);
  useEffect(() => {
    setViewportApi(viewport);
    return () => setViewportApi(null);
  }, [viewport]);
  // Dot grid: stays locked to world coordinates (so dots line up with snap
  // targets) but the *visible* spacing adapts to zoom. Picking a world-step
  // that's a multiple of the snap step (10) and large enough to render
  // ≥ MIN_SCREEN_STEP screen pixels keeps the grid readable from 0.1× to 8×
  // without dots either piling into a haze or growing into giant blobs.
  useEffect(() => {
    const sync = (vp: { tx: number; ty: number; scale: number }) => {
      const el = gridPatternRef.current;
      if (!el) return;
      const worldStep = pickGridStep(vp.scale);
      const screenStep = worldStep * vp.scale;
      el.setAttribute('width', String(screenStep));
      el.setAttribute('height', String(screenStep));
      el.setAttribute('patternTransform', `translate(${vp.tx} ${vp.ty})`);
    };
    sync(viewport.getViewport());
    return viewport.subscribe(sync);
  }, [viewport]);
  const contextMenu = useContextMenu();

  // Open the contextual menu at a screen point, hit-testing the given target
  // so the menu's selection-aware items (cut/copy/rotate/etc.) reflect what
  // the user is pointing at. Shared by mouse right-click and touch long-press.
  const openContextMenuAt = useCallback(
    (clientX: number, clientY: number, target: EventTarget | null) => {
      const store = useEditorStore.getState();
      const tool = store.activeTool;
      if (tool === 'wire' || tool === 'busbar' || tool === 'place') {
        exitDrawingState();
        return;
      }
      const elementId = hitElement(target);
      if (elementId) {
        if (!store.selection.includes(elementId)) {
          store.setSelection([elementId]);
        }
      } else {
        const nodeId = hitNode(target);
        if (nodeId && store.selectedNode !== nodeId) {
          store.setSelectedNode(nodeId);
        }
      }

      const s = useEditorStore.getState();
      const hasSelection = s.selection.length > 0;
      const hasNodeSelection = s.selectedNode != null;
      const hasClipboard = !!s.clipboard;
      const hasAnyElement = s.diagram.elements.length > 0;
      const items: ContextMenuEntry[] = [
        {
          label: t('menu.undo'),
          shortcut: `${MOD}Z`,
          icon: Undo2,
          onSelect: () => useEditorStore.getState().undo(),
          disabled: s.past.length === 0,
        },
        {
          label: t('menu.redo'),
          shortcut: `${MOD}${SHIFT}Z`,
          icon: Redo2,
          onSelect: () => useEditorStore.getState().redo(),
          disabled: s.future.length === 0,
        },
        { type: 'separator' },
        {
          label: t('menu.cut'),
          shortcut: `${MOD}X`,
          icon: Scissors,
          onSelect: () => useEditorStore.getState().cutSelection(),
          disabled: !hasSelection,
        },
        {
          label: t('menu.copy'),
          shortcut: `${MOD}C`,
          icon: Copy,
          onSelect: () => useEditorStore.getState().copySelection(),
          disabled: !hasSelection,
        },
        {
          label: t('menu.paste'),
          shortcut: `${MOD}V`,
          icon: Clipboard,
          onSelect: () => useEditorStore.getState().pasteClipboard(),
          disabled: !hasClipboard,
        },
        { type: 'separator' },
        {
          label: t('menu.rotate'),
          shortcut: 'R',
          icon: RotateCw,
          onSelect: () => useEditorStore.getState().rotateSelection(90),
          disabled: !hasSelection,
        },
        {
          label: t('menu.mirror'),
          shortcut: 'M',
          icon: FlipHorizontal,
          onSelect: () => useEditorStore.getState().mirrorSelection(),
          disabled: !hasSelection,
        },
        { type: 'separator' },
        {
          label: t('menu.selectAll'),
          shortcut: `${MOD}A`,
          icon: BoxSelect,
          onSelect: () => {
            const st = useEditorStore.getState();
            st.setSelection(st.diagram.elements.map((x) => x.id));
          },
          disabled: !hasAnyElement,
        },
        { type: 'separator' },
        {
          label: hasNodeSelection && !hasSelection ? t('menu.disconnect') : t('menu.delete'),
          shortcut: 'Del',
          icon: Trash2,
          destructive: true,
          onSelect: () =>
            hasNodeSelection && !hasSelection
              ? useEditorStore.getState().deleteSelectedNode()
              : useEditorStore.getState().deleteSelection(),
          disabled: !hasSelection && !hasNodeSelection,
        },
      ];
      contextMenu.open(clientX, clientY, items);
    },
    [contextMenu, t],
  );

  // Long-press → context menu (touch-only equivalent of right-click). On
  // touch devices there is no right button, so we open the same menu after
  // the user holds a single finger still for ~700ms. The movement threshold
  // matches PanTool's tap threshold so a slow pan can't accidentally hover
  // long enough to fire the menu mid-drag. A second touch (pinch) cancels
  // via the synthetic pointercancel from useViewport.
  const LONG_PRESS_MS = 700;
  const LONG_PRESS_MOVE_PX = 4;
  const longPressTimer = useRef<number | undefined>(undefined);
  const longPressData = useRef<{
    pointerId: number;
    x: number;
    y: number;
    target: EventTarget | null;
  } | null>(null);

  const cancelLongPress = useCallback(() => {
    window.clearTimeout(longPressTimer.current);
    longPressTimer.current = undefined;
    longPressData.current = null;
  }, []);

  const onPointerDownTouch = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    cancelLongPress();
    longPressData.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      target: e.target,
    };
    const host = hostRef.current;
    longPressTimer.current = window.setTimeout(() => {
      const data = longPressData.current;
      longPressData.current = null;
      longPressTimer.current = undefined;
      if (!data || !host) return;
      // Cancel the active tool's in-progress gesture so the long-press
      // doesn't double as a drag commit when the user releases.
      dispatchSyntheticPointerCancel(host, data.pointerId);
      openContextMenuAt(data.x, data.y, data.target);
    }, LONG_PRESS_MS);
  };

  const onPointerMoveTouch = (e: React.PointerEvent) => {
    const data = longPressData.current;
    if (!data || e.pointerId !== data.pointerId) return;
    const dx = e.clientX - data.x;
    const dy = e.clientY - data.y;
    if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_PX) cancelLongPress();
  };

  const onPointerEndTouch = (e: React.PointerEvent) => {
    const data = longPressData.current;
    if (!data || e.pointerId !== data.pointerId) return;
    cancelLongPress();
  };

  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-oneline-kind')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const onDrop = (e: React.DragEvent) => {
    const kind = e.dataTransfer.getData('application/x-oneline-kind');
    if (!kind) return;
    e.preventDefault();
    const pt = viewport.screenToSvg(e.clientX, e.clientY);
    dropElement(kind, pt);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    openContextMenuAt(e.clientX, e.clientY, e.target);
  };

  return (
    <div
      ref={hostRef}
      className="ole-canvas-root absolute inset-0 overflow-hidden"
      onDragOver={onDragOver}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDownTouch}
      onPointerMove={onPointerMoveTouch}
      onPointerUp={onPointerEndTouch}
      onPointerCancel={onPointerEndTouch}
    >
      <svg
        className="ole-canvas-svg block h-full w-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            ref={gridPatternRef}
            id="ole-grid-dots"
            width={20}
            height={20}
            patternUnits="userSpaceOnUse"
          >
            {/* Dot at the cell corner so every visible dot lands on a snap
                position (snap step = 10, pattern step = 20 → every dot is on
                a multiple-of-20 snap point). */}
            <circle cx={0} cy={0} r={2} fill="var(--canvas-grid-strong)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#ole-grid-dots)" />
        <g ref={groupRef} className="ole-viewport">
          <WireLayer />
          <ElementLayer />
          <AnnotationLayer />
          <FreeAnnotationLayer />
          <SelectionOverlay />
          <BusHandles />
          <TerminalLayer />
          <WirePreview />
          <BusbarPreview />
          <PlaceGhost />
          <MarqueeOverlay />
        </g>
      </svg>
    </div>
  );
}
