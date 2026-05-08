/**
 * Anchored popover that opens upward — used by the bottom-anchored
 * FloatingToolbar / ViewToolbar where a downward-opening menu would clip
 * below the viewport. Closes on outside click and Esc.
 */

import { useEffect, useRef, type ReactNode } from 'react';

export function UpwardPopover({
  open,
  onOpenChange,
  trigger,
  children,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
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
  }, [open, onOpenChange]);
  return (
    <div ref={ref} className="relative">
      {trigger}
      {open && (
        <div
          role="menu"
          className="ole-glass absolute bottom-full right-0 mb-1.5 min-w-52 rounded-md border border-border p-1 shadow-md"
        >
          {children}
        </div>
      )}
    </div>
  );
}
