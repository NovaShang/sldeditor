---
"sldeditor": patch
---

Fix the inverter symbol's orientation. It was the only converter in the library drawn DC-top / AC-bottom — the opposite of every other AC/DC converter (rectifier, converter-bidir, power-supply are all AC-top / DC-bottom), so in a normal PV-below-grid-above layout it rendered upside-down. A full vision audit of all 88 symbols confirmed the inverter is the only one affected.

The fix adds a declarative `transform` (flipV / flipH / rotate180) to the library build pipeline that re-orients a converted QET symbol's graphic **and** terminals together about the viewBox centre, and applies `flipV` to the inverter. The inverter now presents t_ac on top and t_dc on bottom.

Note: diagrams that reference `inverter.t_dc` / `inverter.t_ac` will have those endpoints remap to the corrected physical terminals — which fixes (rather than breaks) diagrams drawn with the natural PV → inverter → grid flow.
