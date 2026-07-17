---
"sldeditor": minor
---

Annotation shapes — rectangles, lines and tables, alongside the existing text notes, so a diagram can be dressed up into a finished drawing sheet.

- **Rectangle / group frame** (F): drag to draw (Shift for a square); solid or dashed stroke, optional faint tint fill, and an optional corner label — the dashed-box-around-a-cabinet convention. Purely decorative: the interior is click-transparent so it never blocks selecting the devices inside it.
- **Line** (L): drag to draw (Shift snaps to 45°); solid/dashed, with optional end or both-ends arrowheads for leaders and dividers. Endpoints are draggable after the fact.
- **Table** (D): drag to sweep out an N×M grid with a live column×row count, or click for a default 3×3. Double-click any cell to edit inline with spreadsheet keys (Tab across, Enter down, Esc to close); drag the outer grips to scale or the internal borders to size individual columns/rows; add/remove rows and columns from the property panel.

Editing model: click to select, click again (or double-click) to edit — text opens its inline editor, a table opens the cell under the cursor. A floating ✓ / ✕ toolbar follows the active editor (Enter / ✓ confirm, Esc / ✕ cancel), and a bottom hint tells the user how to edit whatever is selected. Text/table content, and property-panel edits like table row/column count, repaint live.

All shapes get 8-point resize handles (line gets per-vertex grips), participate in select / move / copy-paste / delete / undo-redo, are theme-aware, and render identically in SVG, PNG and DXF exports (and the AI `render_diagram` feedback raster). `DiagramFile.annotations` is now a discriminated union (`text | rect | line | table`); files written before this release load unchanged (a typeless annotation is treated as text). New exports on the public API: `Annotation`, `RectAnnotation`, `LineAnnotation`, `TableAnnotation`, and the `annotationKind` / `isTextAnnotation` helpers.
