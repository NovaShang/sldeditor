---
'sldeditor': minor
---

Circuit diagrams: "Add contact" and cursor quick-insert.

- **Add contact** — select a coil, contactor or timer (or one of its contacts) and press **C**, use the new toolbar button, the right-click menu or the property panel: pick NO / NC (timers also on-/off-delay NO/NC; a -KM without main contacts also its 3-pole main contacts) and click to place. The new contact carries the device tag and the device's next free terminal numbers per IEC 60947-5-1 / EN 50005 (13-14, 21-22, 33-34, 41-42…; a timer's 55-56 / 67-68 first). Placing works like any place-tool click, including onto a pin.
- **Typing a tag numbers the contact** — renaming a contact to an existing device's tag (e.g. `-KM1`) gives it that device's next free terminal numbers when its own are already taken there.
- **Contacts of a device** — the property panel lists every piece carrying the selected device's tag with its terminal numbers; click one to jump to it.
- **Quick insert** — press **/** over the canvas (or "Insert symbol…" in the right-click menu on empty canvas) to search the library right at the cursor: every word in any order, synonyms, the drawing type's symbols only. ↑/↓ and Enter place the pick at that spot with the usual snapping and pole magnet, or wired to the pin under the cursor. Localised in all editor languages.
