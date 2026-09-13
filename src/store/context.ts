/**
 * Which store a canvas layer reads.
 *
 * The layers (`ElementLayer`, `WireLayer`, …) were written against the
 * `useEditorStore` singleton. A read-only viewer needs the same layers over a
 * PRIVATE store (see `createEditorStore`), so the layers now resolve their
 * store through this context and fall back to the singleton when no provider
 * is mounted — the editor tree is unchanged and pays nothing for it.
 */

import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { useEditorStore, type EditorState } from './store';

export const EditorStoreContext = createContext<StoreApi<EditorState> | null>(null);

/** The store api for the current canvas — for `getState()` in event handlers. */
export function useCanvasStoreApi(): StoreApi<EditorState> {
  return useContext(EditorStoreContext) ?? useEditorStore;
}

/** Drop-in for `useEditorStore(selector)` that honours `EditorStoreContext`. */
export function useCanvasStore<T>(selector: (s: EditorState) => T): T {
  return useStore(useCanvasStoreApi(), selector);
}
