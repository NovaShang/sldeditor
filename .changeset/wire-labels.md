---
"sldeditor": minor
---

New `label` field on wires (`Wire.label?: string`) — a short text rendered mid-wire, intended for phase designations (L1 / L2 / L3 / N / PE). The label anchors at the midpoint of the wire's longest rendered segment, offset clear of the line, and always stays upright: centered above horizontal runs, flowing right of vertical ones. Editable via a new Label input in the properties panel when a wire is selected, included in SVG/PNG and DXF exports, and carried through to `WireRender.label` for embedding apps. Labels survive copy/paste and wire splits, and round-trip untouched through save/load.
