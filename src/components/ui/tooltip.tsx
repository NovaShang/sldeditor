/**
 * Lightweight tooltip — no Radix dependency. Shows content after a short
 * hover delay, portals to body so it isn't clipped by the floating panel,
 * and auto-flips above/below based on viewport space.
 *
 * Usage:
 *   <Tooltip content="Hide grid (G)">
 *     <Button>...</Button>
 *   </Tooltip>
 *
 * The trigger MUST be a single React element accepting a ref; we attach
 * pointer/focus listeners on it without prop-drilling.
 */

import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

const SHOW_DELAY_MS = 350;

interface Anchor {
  top: number;
  left: number;
  side: 'top' | 'bottom';
}

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement<{
    ref?: React.Ref<HTMLElement>;
    onPointerEnter?: (e: React.PointerEvent) => void;
    onPointerLeave?: (e: React.PointerEvent) => void;
    onFocus?: (e: React.FocusEvent) => void;
    onBlur?: (e: React.FocusEvent) => void;
    'aria-describedby'?: string;
  }>;
  /** Force-disable (e.g. when the trigger is disabled). */
  disabled?: boolean;
  /** Override the default 350ms hover delay. */
  delayMs?: number;
}

export function Tooltip({
  content,
  children,
  disabled,
  delayMs = SHOW_DELAY_MS,
}: TooltipProps) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const id = useId();
  const timer = useRef<number | undefined>(undefined);

  const scheduleShow = () => {
    if (disabled) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delayMs);
  };

  const cancelShow = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };

  // Recompute anchor position when open changes or content changes.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !tooltipRef.current) return;
    const t = triggerRef.current.getBoundingClientRect();
    const tip = tooltipRef.current.getBoundingClientRect();
    const margin = 8;
    let side: 'top' | 'bottom' = 'top';
    let top = t.top - tip.height - margin;
    if (top < 4) {
      side = 'bottom';
      top = t.bottom + margin;
    }
    let left = t.left + t.width / 2 - tip.width / 2;
    left = Math.max(4, Math.min(left, window.innerWidth - tip.width - 4));
    setAnchor({ top, left, side });
  }, [open, content]);

  // Cleanup on unmount.
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Hide on Escape and on scroll/resize.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onScroll = () => setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  // We attach our handlers on top of any existing ones on the trigger.
  const child = children;
  const childProps = child.props;
  const wrappedTrigger = cloneElement(child, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      const orig = (child as { ref?: React.Ref<HTMLElement> }).ref;
      if (typeof orig === 'function') orig(node);
      else if (orig && typeof orig === 'object') {
        (orig as React.MutableRefObject<HTMLElement | null>).current = node;
      }
    },
    onPointerEnter: (e: React.PointerEvent) => {
      childProps.onPointerEnter?.(e);
      scheduleShow();
    },
    onPointerLeave: (e: React.PointerEvent) => {
      childProps.onPointerLeave?.(e);
      cancelShow();
    },
    onFocus: (e: React.FocusEvent) => {
      childProps.onFocus?.(e);
      scheduleShow();
    },
    onBlur: (e: React.FocusEvent) => {
      childProps.onBlur?.(e);
      cancelShow();
    },
    'aria-describedby': open ? id : childProps['aria-describedby'],
  });

  return (
    <>
      {wrappedTrigger}
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={tooltipRef}
            id={id}
            role="tooltip"
            data-side={anchor?.side ?? 'top'}
            className="ole-glass pointer-events-none fixed z-[100] max-w-[280px] rounded-md border border-border px-2 py-1 text-[11px] leading-snug text-foreground shadow-md"
            style={{
              top: anchor?.top ?? -9999,
              left: anchor?.left ?? -9999,
              opacity: anchor ? 1 : 0,
              transition: 'opacity 80ms ease-out',
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
