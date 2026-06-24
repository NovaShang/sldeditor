---
"sldeditor": minor
---

Fix reversed terminal IDs on `transformer-2w`, `ct`, `pt`, `fuse`, and `grounding-transformer`

These five elements inherited their terminal order straight from the QElectroTech source, which lists the bottom terminal first — so `t1` ended up at the bottom and `t2` at the top, the opposite of the library-wide convention (`t1` = top/north, `t2` = bottom/south) that every other two-terminal element follows. Because auto-layout derives a symbol's rotation from the local Y of the pin wired to the upper bus, wiring an upper bus to `t1` made these symbols render rotated 180° with awkward wire routing.

Terminal geometry is unchanged; only the `t1`/`t2` assignment is swapped so it matches the convention. The `grounding-transformer` wiring in the `complex-substation` fixture was updated to keep pointing at the same physical terminals.

Note: any saved diagram that references `<id>.t1` / `<id>.t2` on these kinds will have those endpoints remapped to the opposite physical terminal. For diagrams that were authored assuming the standard `t1` = top convention (including AI-generated ones), this corrects the rendering.
