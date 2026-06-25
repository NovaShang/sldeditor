---
"sldeditor": patch
---

Fix: junctions couldn't be dragged in the select tool

`SelectTool` only collected buses and layout-placed devices into the drag set, so a selected junction (which lives outside `internal.layout`, like a bus) produced an empty drag set and the gesture never started. Junctions are now a third draggable category alongside buses — drag-to-move with live preview, marquee box-selection, and clean rollback on gesture cancel.
