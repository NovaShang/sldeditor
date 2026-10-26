---
'sldeditor': minor
---

Drawing sheets (`diagram.sheets`): paper-sized frames (A4–A1, landscape/portrait) with a title block, side by side on one canvas.

- Each sheet draws its border, inner border and title block from one shared layout (`sheetPrimitives`), so the canvas and every export agree. Shared title-block fields (project, client, designer, checker) live in `meta.titleBlock`; per-sheet fields (title, number, date, scale) live on the sheet; "sheet n of N" is automatic.
- A drawing bigger than the paper enlarges the FRAME (`sheet.scale`, nice steps up to 1:20) rather than moving or shrinking the drawing; the export prints it back at paper size. The inspector shows the printed label height (warning below 1.8 mm) with a one-click "enlarge labels for print", and exports keep printed lines at ≥ 0.25 mm.
- Click a sheet's border or title block to select it; dragging moves the sheet and everything on it in one undo step; Delete removes it (contents stay). Marquee never picks sheets.
- Store actions: `addSheet`, `updateSheet`, `removeSheet`, `reorderSheet`, `moveSheet`, `fitSheet`, `enlargeLabelsForPrint`, `updateTitleBlock`, `setSelectedSheet`.
- Export: `buildExportSvg` / `buildExportDxf` draw sheets and accept `region` (one sheet) and `minStrokeWidth`; helpers `sheetExportOptions`, `sheetExportRegion`, `sheetMinStroke`.
- Off-page connectors without a `target` show their partner's sheet ("→ 2/3").
- SmartSLD's old three-annotation frame (`frame_border` / `frame_inner` / `frame_title`) migrates to sheet 1 on load, unchanged in place, with its typed fields.
- `<OneLineEditor onExportSheet>` host callback; `fitToWorldRect`; `sheetFieldLabels` / `sheetOfText`; `--ole-right-panel-reserve` CSS variable for hosts with floating corner buttons.
