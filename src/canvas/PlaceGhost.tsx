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

  // Anchor: cursor always carries one of the ghost's pins, so the visual
  // pointer-to-pin alignment stays continuous across the press → drag →
  // release sequence. Free-place uses the tap-side pin; drag-from-terminal
  // uses the pin that will connect back to the source, which also keeps
  // the dashed wire taut from source to cursor.
  let cursorPin: { x: number; y: number } | null = null;
  let connect: { source: [number, number]; pin: [number, number] } | null = null;
  if (fromRef) {
    const source = resolvePlaceSource(fromRef, cursor);
    if (source) {
      const chosen = pickConnectTerminal(lib, source, cursor);
      cursorPin = chosen;
      connect = { source: source.world, pin: cursor };
    }
  } else {
    cursorPin = pickPlaceCursorTerminal(lib);
  }
  const ghostX = cursor[0] - (cursorPin?.x ?? 0);
  const ghostY = cursor[1] - (cursorPin?.y ?? 0);

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
