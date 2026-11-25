---
"sldeditor": minor
---

Enclosures, wire-crossing hops, and wrapped cable labels.

- **Enclosure** (`annotations[].type: 'enclosure'`, tool `E`, in the Draw menu): a dashed frame around a panel, cabinet or junction box with a name / designation tag ("=+A1") drawn just above its top-left corner. It is selectable, resizable and recolourable like a rect. Dragging it moves only the frame; **Alt-dragging** carries everything inside it (devices, buses, junctions, annotations) in one undo step. Containment is geometric at drag time — nothing is stored, so nothing goes stale. A marquee catches an enclosure only when it covers it whole. Renders on the canvas and in SVG/PNG export, and to its own `ENCLOSURES` layer in DXF (declared only when a drawing has one). Localised in all 11 locales.
- **Wire-crossing hops** (`meta.wireHops`): where two wires cross without connecting, one draws a small arc over the other — the vertical one at a horizontal/vertical crossing, otherwise the later wire. Junction dots, tees and shared endpoints never hop. Canvas and every export draw the same sampled geometry (`WireRender.drawn`). Absent = the previous look, so existing drawings are unchanged; File → New starts with hops on; toggle under View → Wire crossings. The crossing scan is now sort-based instead of all-pairs (≈20× faster on a 1,000-wire drawing), which also speeds up the legacy crossing break on the canvas.
- **Long wire labels**: a label on a vertical run that would reach the next wire to its right (parallel feeders) wraps at word boundaries to fit the gap, on the canvas and in SVG and DXF. Labels that already fit are byte-identical.
