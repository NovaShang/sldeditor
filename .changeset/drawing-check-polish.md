---
'sldeditor': minor
---

Drawing check polish, from a usability walkthrough:

- Portaled overlays (hover label, tooltips) no longer stretch over the whole page: they mount inside a zero-size `.ole-root.ole-portal` wrapper, so their own utilities apply.
- A wire end that only looks joined gets a one-click **Connect** in the panel (`mergeJunctionInto`), and dropping a lone junction on a pin, bus or joint connects it there.
- The checks panel is opaque, stays open while the user edits (`UpwardPopover` `persistent`), has a close button, moves left of the properties panel, and fit/centre keep content out from under it (`data-ole-occludes`).
- Messages name devices by name and type, list the unsupplied devices, and say which bus an unwired device is touching. Notes get a hollow dot while the panel is open; the picked issue gets a ring.
- Load totals show kW, kVA and A; transformers in parallel share the load by rating (`LoadSummary.parallelWith`); "no ratings yet" instead of 0 %.
- The intro waits for a pause, never shows over the quick-start card, and only counts as seen once acknowledged.
- Unset numbers show empty with a "default" placeholder; MW fields show the kW value; labels wrap.
- `useOnboarding` is exported, with a session-only `hide()`.
- New `HealthEvent` type `fix`. Missing `cat.control` / `cat.passive` labels; the zh library falls back to the JSON's Chinese, never to English.
