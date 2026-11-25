---
"sldeditor": minor
---

Control-circuit symbols and editable title-block fields.

- New symbols, converted from QElectroTech elements: solenoid valve (A1/A2, tag -MB), photocell / light-operated switch (13-14, tag -B), changeover contact (11-12-14; "add contact" offers it, so a DPDT relay is a coil plus two changeovers numbered 11-12-14 / 21-22-24), 2-pole contactor main contacts (1-2, 3-4, tag -KM), and PLC digital input / output cards with 8 channels each (L+, L-, I0.0…I0.7 / Q0.0…Q0.7, tag -K). Larger PLCs are several cards with the same tag; the next byte's addresses are set per card under Pin numbers. Search keywords in every UI language.
- Title block: `meta.titleBlock.labels` renames a field and `meta.titleBlock.hidden` leaves it out, on every sheet, in the canvas and in SVG / PNG / PDF / DXF exports. A field whose row partner is hidden takes the whole row; a row with both hidden is dropped. The sheet inspector has a "Title-block fields" section for both. Documents without these settings render exactly as before.
- New exports: `TITLE_BLOCK_FIELDS`, `TitleBlockField`, `isTitleBlockField`, `normalizeTitleBlockFields`.
