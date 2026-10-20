---
"sldeditor": minor
---

Symbols can be resized. A placement takes an optional `scale` (default 1, clamped 0.25–4); terminals, hit areas, selection boxes and label anchors move with it, while line weight and label text size stay the drawing's own. The properties panel gets a Size stepper (25%–400%, click the value to reset). DXF, SVG and PNG exports honour it. Absent `scale` serialises exactly as before.
