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
          if (store.selection.length > 0) {
            e.preventDefault();
            store.deleteSelection();
          }
          return;
        case 'Escape':
          // Cancel in-progress wire, then clear selection / leave place mode.
          if (store.wireFromTerminal) {
            store.setWireFromTerminal(null);
          } else if (store.activeTool === 'place') {
            store.setActiveTool('select');
          } else if (store.selection.length > 0) {
            store.clearSelection();
          }
          return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
