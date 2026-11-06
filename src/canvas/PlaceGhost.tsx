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
 * draw a dashed wire from the source terminal to the pin it will connect to
 * (one per pole for a multi-pole pair) — same visual language as
 * `WirePreview`, so the user sees the connections committed on release.
 */

import { useEditorStore } from '../store';
import { freePlacementAt, planPlaceFromTerminal, type PlaceLink } from './drop-on-bus';

export function PlaceGhost() {
  const tool = useEditorStore((s) => s.activeTool);
  const placeKind = useEditorStore((s) => s.placeKind);
  const cursor = useEditorStore((s) => s.cursorSvg);
  const fromRef = useEditorStore((s) => s.placeFromTerminal);
  // Through the compiled model, not the module-level lookup: the kind being
  // placed may be one this document defines.
  const library = useEditorStore((s) => s.internal.library);

  if (tool !== 'place' || !placeKind || !cursor) return null;
  const lib = library.get(placeKind);
  if (!lib) return null;

  // Same resolution as the commit, so the ghost shows exactly where the
  // element lands. Free-place: the tap-side pin on the cursor, lined up pole
  // for pole with a multi-pole device it sits under. Drag-from-terminal: the
  // pin that connects back to the source (and, for a multi-pole pair, every
  // further pole wired with it) — drawn as dashed conductors.
  let at: [number, number];
  let links: PlaceLink[] = [];
  if (fromRef) {
    const plan = planPlaceFromTerminal(lib, fromRef, cursor);
    if (!plan) return null;
    at = plan.placedAt;
    links = plan.links;
  } else {
    at = freePlacementAt(lib, cursor);
  }

  return (
    <g className="ole-place-ghost-group" pointerEvents="none">
      {links.map((l) => (
        <g key={`${l.from}>${l.pin}`}>
          <line
            x1={l.fromWorld[0]}
            y1={l.fromWorld[1]}
            x2={l.pinWorld[0]}
            y2={l.pinWorld[1]}
            className="ole-wire-preview-line"
          />
          <circle
            cx={l.fromWorld[0]}
            cy={l.fromWorld[1]}
            r={4}
            className="ole-wire-preview-anchor"
          />
        </g>
      ))}
      <g
        className="ole-place-ghost"
        transform={`translate(${at[0]} ${at[1]})`}
        opacity={0.5}
      >
        <g dangerouslySetInnerHTML={{ __html: lib.svg }} />
      </g>
    </g>
  );
}
