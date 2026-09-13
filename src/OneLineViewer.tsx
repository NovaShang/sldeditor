/**
 * `<OneLineViewer>` — the read-only, live-data half of the library.
 *
 * It is the editor's canvas with the editing taken out, not a second
 * renderer: the same layer components (`BusLayer`, `WireLayer`,
 * `ElementLayer`, labels, annotations, selection) draw a `DiagramFile`
 * compiled by the same `compile()`. Two things make that possible without
 * touching the editor:
 *
 *   1. a PRIVATE store (`createEditorStore`) handed to the layers through
 *      `EditorStoreContext`, so a viewer never reads or writes the editor's
 *      persisted singleton and several viewers can share a page;
 *   2. a `RuntimeContext` snapshot of resolved bindings that the layers read
 *      to add `data-alarm` / `data-quality`, hide symbols and swap labels —
 *      with `RuntimeOverlayLayer` drawing the value / badge / `?` adornments.
 *
 * What is deliberately absent: tools, keyboard shortcuts, context menu,
 * toolbars, the grid. Pan (drag / middle button / space) and zoom (wheel /
 * pinch) come from the same `useViewport` the editor uses.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';
import { AnnotationLayer } from './canvas/AnnotationLayer';
import { BusLayer } from './canvas/BusLayer';
import { ElementLayer } from './canvas/ElementLayer';
import { FreeAnnotationLayer } from './canvas/FreeAnnotationLayer';
import { JunctionLayer } from './canvas/JunctionLayer';
import { RuntimeOverlayLayer } from './canvas/RuntimeOverlayLayer';
import { SelectionOverlay } from './canvas/SelectionOverlay';
import { WireLayer } from './canvas/WireLayer';
import { fitToContentWith } from './canvas/fit-to-content';
import { hitElement, hitElementLabel } from './canvas/hit-test';
import { useViewport, type ViewportApi } from './canvas/useViewport';
import type { Theme } from './hooks/use-theme';
import type { DiagramFile } from './model';
import { resolveBindings } from './runtime/bindings';
import {
  EMPTY_RUNTIME,
  RuntimeContext,
  type RuntimeSnapshot,
} from './runtime/runtime-context';
import type { TagSource } from './runtime/tag-source';
import { createEditorStore, EditorStoreContext, type EditorState } from './store';
import type { StoreApi } from 'zustand/vanilla';

export interface OneLineViewerApi {
  /** Fit the whole diagram into the viewport (same as the initial fit). */
  fit(): void;
  /** Centre the viewport on an element / bus / junction and zoom in on it. */
  focus(id: string): void;
  /** Replace the selection. Ignored while `selectedIds` is controlled. */
  select(ids: string[]): void;
}

export interface OneLineViewerProps {
  diagram: DiagramFile;
  /** Live data. Omit for a static rendering — bindings then resolve to nothing. */
  tags?: TagSource;
  /** Controlled selection. Omit to let `api.select` / clicks drive it. */
  selectedIds?: string[];
  /**
   * Controlled hover. `undefined` = follow the pointer; a string or `null`
   * pins the highlight (e.g. mirroring a hovered row in a host list).
   */
  hoveredId?: string | null;
  onElementClick?: (id: string, ev: ReactMouseEvent) => void;
  onElementHover?: (id: string | null) => void;
  onBackgroundClick?: () => void;
  /**
   * Colour mode. Unlike the editor this does NOT touch `<html>`: the class
   * goes on the viewer's own root, so a dark dashboard can hold a light
   * diagram and vice versa. Omit to follow the host's `.dark` ancestor.
   */
  theme?: Theme;
  className?: string;
  style?: CSSProperties;
  /** Fit the diagram on mount, on diagram change and on resize. Default true. */
  fit?: boolean;
  onReady?: (api: OneLineViewerApi) => void;
}

/** Tag changes are batched and applied at most this often. */
const UPDATE_THROTTLE_MS = 100;
/** Frames to retry the initial fit while the canvas DOM is still attaching. */
const FIT_RETRY_FRAMES = 8;
/** Pointer travel below this is a click, above it a pan. */
const CLICK_THRESHOLD_PX = 4;
/** `focus(id)` zooms in to at least this scale. */
const FOCUS_MIN_SCALE = 1.5;

/** Unit of each element's `value` binding, from the diagram's tag index. */
function unitsFor(diagram: DiagramFile): Record<string, string> {
  const units: Record<string, string> = {};
  const bindings = diagram.bindings;
  const tags = diagram.tags;
  if (!bindings || !tags) return units;
  const unitByPath = new Map<string, string>();
  for (const t of tags) if (t.unit) unitByPath.set(t.path, t.unit);
  for (const b of bindings) {
    if (b.prop !== 'value') continue;
    const u = unitByPath.get(b.tag);
    if (u) units[b.target] = u;
  }
  return units;
}

/**
 * Subscribe to the diagram's tags and keep a resolved snapshot, batching
 * bursts of changes into one re-resolve per `UPDATE_THROTTLE_MS`.
 */
function useRuntimeSnapshot(diagram: DiagramFile, tags?: TagSource): RuntimeSnapshot {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(EMPTY_RUNTIME);
  useEffect(() => {
    const bindings = diagram.bindings ?? [];
    if (!tags || bindings.length === 0) {
      setSnapshot(EMPTY_RUNTIME);
      return;
    }
    const units = unitsFor(diagram);
    const resolve = () => setSnapshot({ props: resolveBindings(diagram, tags), units });
    resolve();
    let timer: number | null = null;
    const paths = Array.from(new Set(bindings.map((b) => b.tag)));
    const unsubscribe = tags.subscribe(paths, () => {
      // Trailing-edge throttle: the first change in a window schedules one
      // resolve; everything that arrives before it fires rides along.
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        resolve();
      }, UPDATE_THROTTLE_MS);
    });
    return () => {
      unsubscribe();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [diagram, tags]);
  return snapshot;
}

export function OneLineViewer({
  diagram,
  tags,
  selectedIds,
  hoveredId,
  onElementClick,
  onElementHover,
  onBackgroundClick,
  theme,
  className,
  style,
  fit = true,
  onReady,
}: OneLineViewerProps) {
  // One private store per viewer, seeded synchronously so the first paint
  // already shows the diagram (an effect would flash an empty canvas).
  const [store] = useState(() => {
    const s = createEditorStore();
    s.getState().setReadOnly(true);
    s.getState().setActiveTool('pan');
    s.getState().setDiagram(diagram);
    return s;
  });
  useLayoutEffect(() => {
    if (store.getState().diagram !== diagram) store.getState().setDiagram(diagram);
  }, [diagram, store]);

  // Controlled selection. Runs after the diagram effect (declaration order),
  // so a diagram swap — which resets the store's selection — is re-applied.
  useLayoutEffect(() => {
    if (selectedIds === undefined) return;
    store.getState().setSelection(selectedIds);
  }, [selectedIds, diagram, store]);

  const runtime = useRuntimeSnapshot(diagram, tags);

  const rootClass = [
    'ole-root',
    'ole-viewer',
    theme === 'dark' ? 'dark' : '',
    className ?? 'h-full w-full',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClass} style={style}>
      <EditorStoreContext.Provider value={store}>
        <RuntimeContext.Provider value={runtime}>
          <div className="relative h-full w-full overflow-hidden">
            <ViewerCanvas
              store={store}
              diagram={diagram}
              hoveredId={hoveredId}
              selectionControlled={selectedIds !== undefined}
              onElementClick={onElementClick}
              onElementHover={onElementHover}
              onBackgroundClick={onBackgroundClick}
              fit={fit}
              onReady={onReady}
            />
          </div>
        </RuntimeContext.Provider>
      </EditorStoreContext.Provider>
    </div>
  );
}

interface ViewerCanvasProps {
  store: StoreApi<EditorState>;
  diagram: DiagramFile;
  hoveredId: string | null | undefined;
  selectionControlled: boolean;
  onElementClick?: (id: string, ev: ReactMouseEvent) => void;
  onElementHover?: (id: string | null) => void;
  onBackgroundClick?: () => void;
  fit: boolean;
  onReady?: (api: OneLineViewerApi) => void;
}

function ViewerCanvas({
  store,
  diagram,
  hoveredId,
  selectionControlled,
  onElementClick,
  onElementHover,
  onBackgroundClick,
  fit,
  onReady,
}: ViewerCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const groupRef = useRef<SVGGElement | null>(null);
  // `shared: false` keeps this canvas off the editor's module-level zoom bus.
  const viewport = useViewport(hostRef, groupRef, undefined, { shared: false });

  useViewerHover(hostRef, hoveredId, onElementHover);
  const panned = useViewerPan(hostRef, viewport);

  // Read through a ref so the api object below stays stable for the life of
  // the mount (it is handed out once via `onReady`).
  const selectionControlledRef = useRef(selectionControlled);
  selectionControlledRef.current = selectionControlled;

  const api = useMemo<OneLineViewerApi>(
    () => ({
      fit() {
        const host = hostRef.current;
        if (host) fitToContentWith(viewport, host);
      },
      focus(id) {
        const host = hostRef.current;
        if (!host) return;
        const at = worldPositionOf(store.getState(), id);
        if (!at) return;
        const rect = host.getBoundingClientRect();
        const scale = Math.max(viewport.getViewport().scale, FOCUS_MIN_SCALE);
        viewport.setViewport({
          scale,
          tx: rect.width / 2 - scale * at[0],
          ty: rect.height / 2 - scale * at[1],
        });
      },
      select(ids) {
        if (selectionControlledRef.current) return;
        store.getState().setSelection(ids);
      },
    }),
    [viewport, store],
  );

  // Initial fit + refit on diagram change. Retries a few frames because the
  // fit measures the rendered DOM, which may not be attached on frame one.
  useEffect(() => {
    if (!fit) return;
    let frames = FIT_RETRY_FRAMES;
    let raf = 0;
    const tick = () => {
      const host = hostRef.current;
      if (host && fitToContentWith(viewport, host)) return;
      if (--frames > 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fit, diagram, viewport]);

  // Refit when the host resizes (a dashboard panel opening, a window resize).
  useEffect(() => {
    const host = hostRef.current;
    if (!fit || !host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      fitToContentWith(viewport, host);
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [fit, viewport]);

  // `onReady` fires once per mount — `api` is stable, see above.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    onReadyRef.current?.(api);
  }, [api]);

  const onClick = useCallback(
    (e: ReactMouseEvent) => {
      // A drag that ended on the host still produces a click — swallow it.
      if (panned.current) {
        panned.current = false;
        return;
      }
      const id = hitElement(e.target) ?? hitElementLabel(e.target);
      if (id) onElementClick?.(id, e);
      else onBackgroundClick?.();
    },
    [onElementClick, onBackgroundClick, panned],
  );

  return (
    <div
      ref={hostRef}
      className="ole-canvas-root absolute inset-0 overflow-hidden"
      data-tool="pan"
      onClick={onClick}
    >
      <svg className="ole-canvas-svg block h-full w-full" xmlns="http://www.w3.org/2000/svg">
        <g ref={groupRef} className="ole-viewport">
          <BusLayer />
          <WireLayer />
          <JunctionLayer />
          <ElementLayer />
          <AnnotationLayer />
          <FreeAnnotationLayer />
          <SelectionOverlay />
          <RuntimeOverlayLayer />
        </g>
      </svg>
    </div>
  );
}

/** World coordinate of an element / bus / junction, for `focus()`. */
function worldPositionOf(s: EditorState, id: string): [number, number] | null {
  const place = s.internal.layout.get(id);
  if (place) return place.at;
  const bus = s.internal.buses.get(id);
  if (bus) return bus.geometry.at;
  const j = s.internal.junctions.get(id);
  if (j) return j.world;
  return null;
}

const HOVER_CLASS = 'ole-hover-element-host';

function cssEscape(s: string): string {
  return s.replace(/(["\\])/g, '\\$1');
}

/**
 * Hover highlight. Pointer-driven by default (a class toggled straight on the
 * DOM, no React re-render per move — same technique as the editor's
 * `useHoverHighlight`); pinned to `hoveredId` when the host controls it.
 * `onElementHover` always reports the pointer, controlled or not.
 */
function useViewerHover(
  hostRef: RefObject<HTMLDivElement | null>,
  hoveredId: string | null | undefined,
  onElementHover?: (id: string | null) => void,
): void {
  const applied = useRef<string | null>(null);
  const pointer = useRef<string | null>(null);
  const controlled = useRef(hoveredId);
  controlled.current = hoveredId;
  const onHoverRef = useRef(onElementHover);
  onHoverRef.current = onElementHover;

  const apply = useCallback(
    (id: string | null) => {
      const host = hostRef.current;
      if (!host || id === applied.current) return;
      if (applied.current) {
        host
          .querySelector(`[data-element-id="${cssEscape(applied.current)}"]`)
          ?.classList.remove(HOVER_CLASS);
      }
      if (id) {
        host
          .querySelector(`[data-element-id="${cssEscape(id)}"]`)
          ?.classList.add(HOVER_CLASS);
      }
      applied.current = id;
    },
    [hostRef],
  );

  useEffect(() => {
    apply(hoveredId === undefined ? pointer.current : hoveredId);
  }, [hoveredId, apply]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = (id: string | null) => {
      if (id === pointer.current) return;
      pointer.current = id;
      onHoverRef.current?.(id);
      if (controlled.current === undefined) apply(id);
    };
    const onMove = (e: PointerEvent) =>
      update(hitElement(e.target) ?? hitElementLabel(e.target));
    const onLeave = () => update(null);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    return () => {
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      apply(null);
    };
  }, [hostRef, apply]);
}

/**
 * Left-button (or single-finger) drag pans. Returns a ref that is `true`
 * after a drag so the click handler can tell a pan from a tap. Middle-button
 * and space+drag pans, wheel zoom and pinch live in `useViewport`.
 */
function useViewerPan(
  hostRef: RefObject<HTMLDivElement | null>,
  viewport: ViewportApi,
): RefObject<boolean> {
  const panned = useRef(false);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let active: {
      pointerId: number;
      startX: number;
      startY: number;
      startTx: number;
      startTy: number;
      moved: boolean;
    } | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const vp = viewport.getViewport();
      active = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startTx: vp.tx,
        startTy: vp.ty,
        moved: false,
      };
      panned.current = false;
    };
    const onMove = (e: PointerEvent) => {
      if (!active || e.pointerId !== active.pointerId) return;
      const dx = e.clientX - active.startX;
      const dy = e.clientY - active.startY;
      if (!active.moved) {
        if (Math.hypot(dx, dy) <= CLICK_THRESHOLD_PX) return;
        active.moved = true;
        panned.current = true;
        host.classList.add('ole-viewer-panning');
        try {
          host.setPointerCapture(e.pointerId);
        } catch {
          /* pointer may already be gone */
        }
      }
      viewport.setViewport({ tx: active.startTx + dx, ty: active.startTy + dy });
    };
    const onUp = (e: PointerEvent) => {
      if (!active || e.pointerId !== active.pointerId) return;
      if (host.hasPointerCapture?.(e.pointerId)) {
        try {
          host.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      host.classList.remove('ole-viewer-panning');
      active = null;
    };

    host.addEventListener('pointerdown', onDown);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerup', onUp);
    host.addEventListener('pointercancel', onUp);
    return () => {
      host.removeEventListener('pointerdown', onDown);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerup', onUp);
      host.removeEventListener('pointercancel', onUp);
      host.classList.remove('ole-viewer-panning');
    };
  }, [hostRef, viewport]);
  return panned;
}
