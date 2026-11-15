---
"sldeditor": minor
---

Symbol text stays readable, and hosts can see drawing-tool use.

- Mirrored symbols no longer render their own text backwards (e.g. the "V" of a voltmeter, or any text in a document-defined symbol). Each `<text>` is counter-flipped about its anchor with its alignment swapped, on the canvas and in SVG/PNG export; DXF writes the text forwards with mirrored justification instead of the "backward" flag.
- Text inside document-defined symbols (`customKinds`) is normalised for print: solid fill, no stroke, explicit font family and size. Text inherited `fill="none"` + `stroke` from a wrapping group printed as unreadable outlines in PDF/PNG, and an unsized text rendered at different sizes on canvas, in export and in DXF.
- DXF export now descends into plain (untransformed) `<g>` groups in a symbol, and honours inherited `font-size` / `text-anchor`.
- New `onToolUse?: (e: ToolUseEvent) => void` prop on `OneLineEditor`: called once each time the user switches to a drawing tool (wire, busbar, place, junction, text, rect, ellipse, line, table) with `{ tool, diagramType }`. `select`/`pan` and read-only mode are not reported.
