/**
 * Floating name tag that follows the hovered element on the canvas. Reads
 * the hover signal published by `useHoverHighlight` and locates the
 * element's `<g>` via the DOM (so it tracks pan, zoom, and live drags
 * without re-rendering React). Shows `name (kind)` or just `id` for
 * unnamed elements; portals to body so it isn't clipped.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { libraryById } from '@/element-library';
import { useEditorStore } from '@/store';
import type { ElementId } from '@/model';
import { getHoverElement, subscribeHoverElement } from './hover-bus';

interface Anchor {
  top: number;
  left: number;
}

const GAP_PX = 10;
const SHOW_DELAY_MS = 100;

export function ElementHoverLabel() {
  const [hoverId, setHoverId] = useState<ElementId | null>(getHoverElement());
  const [shown, setShown] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const showTimer = useRef<number | undefined>(undefined);

  // The hover signal can flicker as the cursor crosses element edges. The
  // delayed-show smooths that out without making the tooltip feel laggy on
  // a steady hover.
  useEffect(() => {
    return subscribeHoverElement((id) => setHoverId(id));
  }, []);

  useEffect(() => {
    window.clearTimeout(showTimer.current);
    // Hide first whenever the target changes — keeps the tooltip from
    // teleporting between elements during fast cursor sweeps. The new label
    // re-appears only after the cursor settles on `hoverId` for SHOW_DELAY_MS.
    setShown(false);
    setAnchor(null);
    if (!hoverId) return;
    showTimer.current = window.setTimeout(() => setShown(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(showTimer.current);
  }, [hoverId]);

  // Look up the element name + kind for the current hover.
  const elementName = useEditorStore((s) => {
    if (!hoverId) return null;
    return s.diagram.elements.find((e) => e.id === hoverId) ?? null;
  });

  // Reposition each frame while shown — handles pan/zoom/drag without React.
  useLayoutEffect(() => {
    if (!shown || !hoverId) return;
    let raf = 0;
    let lastTop = -1;
    let lastLeft = -1;
    const tick = () => {
      const node = document.querySelector(
        `[data-element-id="${cssEscape(hoverId)}"]`,
      );
      const tip = labelRef.current;
      if (node && tip) {
        const r = node.getBoundingClientRect();
        // Default below so we don't collide with the contextual toolbar
        // (which prefers above the selection); flip up only when there's
        // no room below.
        let top = r.bottom + GAP_PX;
        if (top + tip.offsetHeight > window.innerHeight - 4) {
          top = r.top - tip.offsetHeight - GAP_PX;
        }
        let left = r.left + r.width / 2 - tip.offsetWidth / 2;
        left = Math.max(4, Math.min(left, window.innerWidth - tip.offsetWidth - 4));
        if (top !== lastTop || left !== lastLeft) {
          setAnchor({ top, left });
          lastTop = top;
          lastLeft = left;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [shown, hoverId]);

  if (!shown || !hoverId || !elementName) return null;
  const lib = libraryById[elementName.kind];
  const display = elementName.name ?? elementName.id;
  const subtitle = lib?.name ?? elementName.kind;
  const showId = elementName.name && elementName.name !== elementName.id;

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={labelRef}
      role="tooltip"
      className="ole-glass pointer-events-none fixed z-[100] flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] leading-snug shadow-md"
      style={{
        top: anchor?.top ?? -9999,
        left: anchor?.left ?? -9999,
        opacity: anchor ? 1 : 0,
        transition: 'opacity 80ms ease-out',
      }}
    >
      <span className="font-medium text-foreground">{display}</span>
      {showId && (
        <span className="font-mono text-[10px] text-muted-foreground">
          {elementName.id}
        </span>
      )}
      <span className="text-muted-foreground/80">·</span>
      <span className="text-muted-foreground">{subtitle}</span>
    </div>,
    document.body,
  );
}

function cssEscape(s: string): string {
  return s.replace(/(["\\])/g, '\\$1');
}
