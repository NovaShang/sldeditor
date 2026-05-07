/**
 * Lightweight right-click menu. Self-contained (no Radix popper) — items are
 * built on demand by the caller and passed via `useContextMenu().open()`.
 *
 * Position-flips by measuring the rendered menu in a layout effect, so the
 * first frame is hidden until the clamp is applied. Dismisses on outside
 * click, Esc, scroll, and window blur.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

export interface ContextMenuItem {
  type?: 'item';
  label: string;
  shortcut?: string;
  icon?: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
}
export interface ContextMenuSeparator {
  type: 'separator';
}
export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

interface ContextMenuApi {
  open: (x: number, y: number, items: ContextMenuEntry[]) => void;
  close: () => void;
}

const Ctx = createContext<ContextMenuApi | null>(null);

export function useContextMenu(): ContextMenuApi {
  const api = useContext(Ctx);
  if (!api) {
    throw new Error('useContextMenu must be used inside <ContextMenuHost>');
  }
  return api;
}

interface MenuState {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuEntry[];
}

const VIEWPORT_PAD = 8;

export function ContextMenuHost({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MenuState>({
    open: false,
    x: 0,
    y: 0,
    items: [],
  });
  const [clamped, setClamped] = useState<{ left: number; top: number } | null>(
    null,
  );
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setState((s) => (s.open ? { ...s, open: false } : s));
  }, []);

  const open = useCallback(
    (x: number, y: number, items: ContextMenuEntry[]) => {
      setClamped(null);
      setState({ open: true, x, y, items });
    },
    [],
  );

  const api = useMemo<ContextMenuApi>(() => ({ open, close }), [open, close]);

  useLayoutEffect(() => {
    if (!state.open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    let left = state.x;
    let top = state.y;
    // Flip to the opposite side if the menu would overflow.
    if (left + r.width > window.innerWidth - VIEWPORT_PAD) {
      left = Math.max(VIEWPORT_PAD, state.x - r.width);
    }
    if (top + r.height > window.innerHeight - VIEWPORT_PAD) {
      top = Math.max(VIEWPORT_PAD, state.y - r.height);
    }
    setClamped({ left, top });
  }, [state]);

  useEffect(() => {
    if (!state.open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    const onWheel = () => close();
    const onBlur = () => close();
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('blur', onBlur);
    };
  }, [state.open, close]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {state.open && (
        <div
          ref={ref}
          role="menu"
          aria-orientation="vertical"
          className="ole-glass fixed z-50 min-w-[200px] rounded-md border border-border p-1 text-sm shadow-md"
          style={{
            left: clamped?.left ?? state.x,
            top: clamped?.top ?? state.y,
            visibility: clamped ? 'visible' : 'hidden',
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {state.items.map((entry, i) => {
            if (entry.type === 'separator') {
              return (
                <div
                  key={`sep-${i}`}
                  role="separator"
                  className="my-1 h-px bg-border"
                />
              );
            }
            const Icon = entry.icon;
            return (
              <button
                key={`${entry.label}-${i}`}
                type="button"
                role="menuitem"
                disabled={entry.disabled}
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left',
                  'hover:bg-accent hover:text-accent-foreground',
                  'focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none',
                  entry.destructive &&
                    'text-destructive hover:bg-destructive/10 hover:text-destructive',
                  entry.disabled &&
                    'pointer-events-none text-muted-foreground opacity-60',
                )}
                onClick={() => {
                  close();
                  entry.onSelect();
                }}
              >
                <span className="flex items-center gap-2">
                  {Icon ? <Icon className="size-4" /> : null}
                  <span>{entry.label}</span>
                </span>
                {entry.shortcut ? (
                  <span className="text-xs text-muted-foreground">
                    {entry.shortcut}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </Ctx.Provider>
  );
}
