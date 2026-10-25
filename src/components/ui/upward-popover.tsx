/**
 * Anchored popover that opens upward — used by the bottom-anchored
 * FloatingToolbar / ViewToolbar where a downward-opening menu would clip
 * below the viewport. Closes on outside click and Esc; a panel the user works
 * alongside (the checks list, while they fix the drawing) opts out of the
 * outside click with `persistent`.
 *
 * While open, the content carries `ole-upward-popover`, so a host can move its
 * own floating chrome out of the way (`body:has(.ole-upward-popover)`).
 */

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

export function UpwardPopover({
  open,
  onOpenChange,
  trigger,
  children,
  persistent = false,
  className,
  style,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
  persistent?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (persistent) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange, persistent]);
  return (
    <div ref={ref} className="relative">
      {trigger}
      {open && (
        <div
          role="menu"
          className={cn(
            'ole-glass ole-upward-popover absolute bottom-full right-0 mb-1.5 min-w-52 rounded-md border border-border p-1 shadow-md',
            className,
          )}
          style={style}
        >
          {children}
        </div>
      )}
    </div>
  );
}
