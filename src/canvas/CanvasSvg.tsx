/**
 * Top-level canvas SVG. Owns the pan/zoom viewport `<g>` and the static
 * grid background; layers (wires, elements, terminals) are children of the
 * viewport so they pan/zoom together.
 *
 * Z-order (back to front): grid → wires → elements → terminals.
 * Terminals on top because they're the smallest and most clickable.
 */

import { useRef } from 'react';
import { ElementLayer } from './ElementLayer';
import { TerminalLayer } from './TerminalLayer';
import { WireLayer } from './WireLayer';
import { useViewport } from './useViewport';

export function CanvasSvg() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const groupRef = useRef<SVGGElement | null>(null);
  useViewport(hostRef, groupRef);

  return (
    <div ref={hostRef} className="ole-canvas-root absolute inset-0 overflow-hidden">
      <svg
        className="ole-canvas-svg block h-full w-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id="ole-grid-dots"
            width={20}
            height={20}
            patternUnits="userSpaceOnUse"
          >
            <circle cx={1} cy={1} r={0.6} fill="var(--canvas-grid)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#ole-grid-dots)" />
        <g ref={groupRef} className="ole-viewport">
          <WireLayer />
          <ElementLayer />
          <TerminalLayer />
        </g>
      </svg>
    </div>
  );
}
