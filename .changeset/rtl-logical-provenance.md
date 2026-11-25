---
"sldeditor": minor
---

Right-to-left layout and item provenance.

- **RTL:** under `dir="rtl"` the editor chrome now mirrors — the library panel, outline, bottom toolbar row, properties panel, view toolbar, health panel and menus anchor with logical start/end instead of physical left/right. The drawing itself never mirrors (the canvas SVG is pinned to `direction: ltr`), so the canvas matches the exports in every language. Hosts can reserve room with the new logical `--ole-start-inset` / `--ole-end-inset`; the existing `--ole-left-inset` / `--ole-right-inset` keep working and stay physical. The Arabic, Persian and Hebrew place-tool hints no longer say the library is "on the left".
- **Provenance:** elements, buses, junctions, wires and annotations accept an optional `by?: 'ai'` field (`Provenance` type) recording that an AI assistant created them; absent means the user. It survives save/load, is kept by edits, dropped from copies the user pastes, and never rendered or exported to SVG/PNG/PDF/DXF.
