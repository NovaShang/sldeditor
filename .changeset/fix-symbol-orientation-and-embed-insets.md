---
"sldeditor": patch
---

Symbol orientation + embed-inset fixes:

- **panelboard orientation** — the distribution-centre symbol was drawn incoming-at-bottom (terminal `orientation: 's'`), which is upside down for a load (a load center takes its feeder from above). Flipped it vertically so the incoming terminal is at the top (`'n'`, matching the `load` / `ev-charger` convention) with the branch ways at the bottom.
- **pv orientation** — the PV generator's DC terminal exited east at an off-axis point (`x: 50`), forcing layouts to shift downstream symbols by +50x to avoid a jogged wire. Moved it to the panel's bottom edge on the symbol axis (`x: 0`, `orientation: 's'`) so PV feeds straight down into a combiner/inverter like every other source.
- **embedder inset regression** — `.ole-root` redeclared the embedder inset variables (`--ole-*-inset`) from `env(safe-area-inset-*)`, shadowing a host's own value for every floating panel inside the editor. An embedding app that reserved right-edge space (e.g. for a side panel) had its properties panel drawn underneath that space. Safe-area now lives in separate `--ole-safe-*` variables and the floating chrome sums the two, so both the host inset and the mobile safe-area are honored.
