/**
 * Top-level canvas SVG. Owns the pan/zoom viewport `<g>`, the static grid
 * background, and the active-tool dispatcher. Layers (wires, elements,
 * selection, terminals, previews) are children of the viewport so they
 * pan/zoom together.
 *
 * Z-order (back to front): grid → wires → elements → selection → terminals
 * → wire preview → place ghost.
 */

import { useEffect, useRef } from 'react';
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
import { exitDrawingState } from './useKeyboardShortcuts';
import { useHoverHighlight } from './useHoverHighlight';
import { useTools } from './useTools';
import { useViewport } from './useViewport';

const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iP(ad|hone|od)/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl+';
const SHIFT = IS_MAC ? '⇧' : 'Shift+';

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
  // Keep the dot grid locked to world coordinates so it pans / zooms with the
  // canvas. Without this the grid lives in screen space and slides past the
  // snap targets, which made placed elements look "off the grid".
  useEffect(() => {
    const sync = (vp: { tx: number; ty: number; scale: number }) => {
      const el = gridPatternRef.current;
      if (!el) return;
      el.setAttribute(
        'patternTransform',
        `translate(${vp.tx} ${vp.ty}) scale(${vp.scale})`,
      );
    };
    sync(viewport.getViewport());
    return viewport.subscribe(sync);
  }, [viewport]);
  const contextMenu = useContextMenu();

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
    const store = useEditorStore.getState();
    // In drawing tools, right-click steps out of the current drawing state
    // (mirrors Esc) instead of opening the contextual menu.
    const tool = store.activeTool;
    if (tool === 'wire' || tool === 'busbar' || tool === 'place') {
      exitDrawingState();
      return;
    }
    // If right-clicking an element that isn't part of the current selection,
    // make it the selection — matches Figma / desktop-app convention.
    const elementId = hitElement(e.target);
    if (elementId) {
      if (!store.selection.includes(elementId)) {
        store.setSelection([elementId]);
      }
    } else {
      // No element under cursor — try a wire instead, so right-clicking a
      // wire surfaces wire-relevant operations.
      const nodeId = hitNode(e.target);
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
    contextMenu.open(e.clientX, e.clientY, items);
  };

  return (
    <div
      ref={hostRef}
      className="ole-canvas-root absolute inset-0 overflow-hidden"
      onDragOver={onDragOver}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
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
            <circle cx={0} cy={0} r={1} fill="var(--canvas-grid-strong)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#ole-grid-dots)" />
        <g ref={groupRef} className="ole-viewport">
          <WireLayer />
          <ElementLayer />
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
