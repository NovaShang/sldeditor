---
"sldeditor": patch
---

Default element label position moved from the symbol's top-right to its right edge, vertically centered. Labels without an explicit per-symbol anchor (currently all of them) now sit beside the middle of the symbol, which reads better for typical one-line names. Shared with the SVG/DXF exporters, so exported labels move too.
