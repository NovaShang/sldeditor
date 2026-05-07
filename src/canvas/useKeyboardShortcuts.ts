/**
 * Global editor shortcuts. Runs once via the OneLineEditor root component
 * and reads/writes the store via `getState`. Shortcuts are inert when
 * focus is in an editable input/textarea so the property panel doesn't
 * eat the user's typing.
 */

import { useEffect } from 'react';
import { useEditorStore } from '@/store';

function isEditing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

/**
 * Step out of drawing state. Wire/busbar tools always return to select.
 * Place tool clears its placeKind first; if no kind is selected, returns to
 * select. For non-drawing tools, falls back to clearing selection. Shared
 * between Esc and the canvas right-click handler.
 */
export function exitDrawingState(): void {
  const store = useEditorStore.getState();
  const tool = store.activeTool;
  if (tool === 'wire' || tool === 'busbar') {
    store.setActiveTool('select');
    return;
  }
  if (tool === 'place') {
    if (store.placeFromTerminal) store.setPlaceFromTerminal(null);
    else if (store.placeKind) store.setPlaceKind(null);
    else store.setActiveTool('select');
    return;
  }
  if (store.selectedNode || store.selection.length > 0) {
    store.clearSelection();
  }
}

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditing(e.target)) return;

      const mod = e.metaKey || e.ctrlKey;
      const store = useEditorStore.getState();

      // Cmd+Z / Cmd+Shift+Z — undo / redo. Save shortcut handled in TopBar.
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      // Cmd+Y — redo (Windows convention)
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.redo();
        return;
      }
      // Cmd+A — select all elements
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const ids = useEditorStore.getState().diagram.elements.map((x) => x.id);
        store.setSelection(ids);
        return;
      }
      // Cmd+C / Cmd+X / Cmd+V — copy / cut / paste
      if (mod && !e.shiftKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'c') {
          if (store.selection.length === 0) return;
          e.preventDefault();
          store.copySelection();
          return;
        }
        if (k === 'x') {
          if (store.selection.length === 0) return;
          e.preventDefault();
          store.cutSelection();
          return;
        }
        if (k === 'v') {
          if (!store.clipboard) return;
          e.preventDefault();
          store.pasteClipboard();
          return;
        }
      }
      if (mod) return; // ignore other modified keys

      switch (e.key) {
        case 'v':
        case 'V':
          store.setActiveTool('select');
          return;
        case 'h':
        case 'H':
          store.setActiveTool('pan');
          return;
        case 'w':
        case 'W':
          store.setActiveTool('wire');
          return;
        case 'b':
        case 'B':
          store.setActiveTool('busbar');
          return;
        case 'p':
        case 'P':
          store.setActiveTool('place');
          return;
        case 'r':
        case 'R':
          if (store.selection.length > 0) {
            e.preventDefault();
            store.rotateSelection(90);
          }
          return;
        case 'm':
        case 'M':
          if (store.selection.length > 0) {
            e.preventDefault();
            store.mirrorSelection();
          }
          return;
        case 'Delete':
        case 'Backspace':
          if (store.selectedNode) {
            e.preventDefault();
            store.deleteSelectedNode();
          } else if (store.selection.length > 0) {
            e.preventDefault();
            store.deleteSelection();
          }
          return;
        case 'Escape':
          exitDrawingState();
          return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
