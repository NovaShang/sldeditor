/**
 * Half-transparent preview of the kind being placed, following the cursor
 * during the place tool.
 *
 * The cursor "carries" one of the new element's terminals (the tap-side
 * pin — same one `dropElement` snaps to a bus, and the same one used for
 * free-placement). Visually this means the pointer touches the pin you'd
 * expect to drop onto a wire/bus, not the element's centroid.
 *
 * In drag-from-terminal mode (`placeFromTerminal != null`) we additionally
 * draw a dashed wire from the source terminal to whichever pin of the ghost
 * is closest — same visual language as `WirePreview`, so the user sees the
 * connection that will be committed on release.
 */

import { useEditorStore } from '../store';
import { getLibraryEntry } from '../compiler';
import {
  pickConnectTerminal,
  pickPlaceCursorTerminal,
  resolvePlaceSource,
} from './drop-on-bus';

export function PlaceGhost() {
  const tool = useEditorStore((s) => s.activeTool);
  const placeKind = useEditorStore((s) => s.placeKind);
  const cursor = useEditorStore((s) => s.cursorSvg);
  const fromRef = useEditorStore((s) => s.placeFromTerminal);

  if (tool !== 'place' || !placeKind || !cursor) return null;
  const lib = getLibraryEntry(placeKind);
  if (!lib) return null;

  // Anchor: cursor carries the tap-side pin in free-place mode. In
  // drag-from-terminal mode the ghost still follows the raw cursor — the
  // wire preview shows the connection back to the source instead.
  const cursorPin = !fromRef ? pickPlaceCursorTerminal(lib) : null;
  const ghostX = cursor[0] - (cursorPin?.x ?? 0);
  const ghostY = cursor[1] - (cursorPin?.y ?? 0);

  let connect: { source: [number, number]; pin: [number, number] } | null = null;
  if (fromRef) {
    const source = resolvePlaceSource(fromRef, cursor);
    if (source) {
      const chosen = pickConnectTerminal(lib, source, cursor);
      connect = {
        source: source.world,
        pin: [cursor[0] + chosen.x, cursor[1] + chosen.y],
      };
    }
  }

  return (
    <g className="ole-place-ghost-group" pointerEvents="none">
      {connect && (
        <>
          <line
            x1={connect.source[0]}
            y1={connect.source[1]}
            x2={connect.pin[0]}
            y2={connect.pin[1]}
            className="ole-wire-preview-line"
          />
          <circle
            cx={connect.source[0]}
            cy={connect.source[1]}
            r={4}
            className="ole-wire-preview-anchor"
          />
        </>
      )}
      <g
        className="ole-place-ghost"
        transform={`translate(${ghostX} ${ghostY})`}
        opacity={0.5}
      >
        <g dangerouslySetInnerHTML={{ __html: lib.svg }} />
      </g>
    </g>
  );
}
