---
"sldeditor": minor
---

Junction dots now follow the schematic solder-dot convention instead of always being drawn. A visible dot appears at rest only where 3+ conductors meet (a real tee/cross); a corner or pass-through junction (degree ≤ 2) stays hidden so the canvas isn't peppered with unnecessary dots. Hidden junctions still reveal themselves whenever the user might act on them — on hover of the junction or a connected wire, while a drawing/placing tool (wire/place/junction/busbar) is active, and on selection — and the wide invisible hit target keeps every junction clickable regardless. Exports (SVG/PNG, and the AI `render_diagram` raster) now omit degree ≤ 2 dots, matching the convention. `ResolvedJunction` gains a `degree` field, and the canvas host carries a `data-tool` attribute reflecting the active tool.
