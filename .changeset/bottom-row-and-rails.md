---
"sldeditor": minor
---

Bottom toolbar row never overlaps any more, and circuit-diagram rails draw as conductors.

- The outline tab, the main toolbar and the view toolbar now report their measured widths, and the row picks how far to collapse from what actually fits (labels → icons → one unified bar) instead of fixed width breakpoints. Between roughly 1000 and 1300 px the view toolbar used to cover Undo / Redo / Layout, and longer labels (German, Russian) collided earlier still. The main toolbar stays dead centre whenever it can; it drops its labels before it slides aside.
- Circuit diagrams: no Busbar tool (button and `B` shortcut hidden, the quick-start busbar tip too; an active busbar tool drops back to Select). Buses on a circuit diagram are supply rails and draw at conductor weight instead of busbar weight, on the canvas and in SVG/PNG/PDF; a green-yellow rail gets PE stripes everywhere, DXF included.
