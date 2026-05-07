/**
 * Half-transparent preview of the kind being placed, following the cursor
 * during the place tool. When `placeKind` or `cursorSvg` is unset the
 * component renders nothing.
 */

import { useEditorStore } from '@/store';
import { getLibraryEntry } from '@/compiler';

export function PlaceGhost() {
  const tool = useEditorStore((s) => s.activeTool);
  const placeKind = useEditorStore((s) => s.placeKind);
  const cursor = useEditorStore((s) => s.cursorSvg);

  if (tool !== 'place' || !placeKind || !cursor) return null;
  const lib = getLibraryEntry(placeKind);
  if (!lib) return null;

  return (
    <g
      className="ole-place-ghost"
      pointerEvents="none"
      transform={`translate(${cursor[0]} ${cursor[1]})`}
      opacity={0.5}
    >
      <g dangerouslySetInnerHTML={{ __html: lib.svg }} />
    </g>
  );
}
