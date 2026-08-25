---
'sldeditor': minor
---

A document can define its own symbols, and the drawing tools collapse into one button.

**`DiagramFile.customKinds`** — symbols that live in the drawing rather than in
the shipped library, satisfying the same `LibraryEntry` contract a built-in
does. A custom kind is a real device everywhere it counts: it compiles, wires
up, joins connectivity nodes, raises diagnostics and exports to SVG and DXF
through exactly the paths a built-in uses. No parallel machinery exists for it.

This is aimed at the ceiling fixed pin counts create. `panelboard` has one
terminal, `dc-combiner` is fixed at four strings, and a terminal strip is
parameterised by how many ways it has — so those things could not be modelled
at all, and users drew them by hand instead. A definition may also carry
`stretchable`, which until now only `busbar` used.

Symbols are embedded, never referenced: a drawing travels through public links,
forks and downloads, and a reference would hand the recipient a file full of
kinds they cannot resolve. Ids carry a `custom:` prefix and anything else is
dropped — "define a new symbol" and "redefine `breaker` for everyone who opens
this file" are very different features.

New API for embedding hosts:

- `mergeCustomKinds`, `isCustomKind`, `CUSTOM_KIND_PREFIX` — the merged lookup,
  also published on `InternalModel.library`.
- `sanitizeSymbolSvg`, `validateCustomKind` — the two gates a generated symbol
  must pass. The sanitiser is an allowlist measured from the 92 shipped
  symbols, not designed: exactly the 9 elements and 24 attributes they use,
  which is also exactly what the DXF translator can emit. `validateCustomKind`
  catches symbols that are safe but wrong in a way every future use inherits —
  chiefly a two-terminal device whose pins share neither axis, which renders a
  jogged wire in every drawing forever.
- `onCreateComponent` on `<OneLineEditor>`, surfaced as a button in the
  component palette. Authoring a symbol means asking an AI agent, which lives
  in the host app.
- `removeCustomKind` on the store, which refuses while instances are placed and
  returns the count so a confirmation can say something true.

**Stroke width now works.** `.ole-ann-rect-border` and `.ole-ann-line` declared
`stroke-width: 1` in CSS, and a CSS declaration always beats the SVG
presentation attribute the shape sets — so every annotation stayed a hairline
whatever the property panel said. The exporters write the attribute explicitly
and were correct all along, which is why this survived a test asserting
`stroke-width="3"` in exported SVG.

**The five drawing tools are behind one "Draw" button.** Flat, they were half
the toolbar. Hotkeys are unchanged. Stroke style and weight are now shown as
little lines rather than named, which fits a narrow panel in any language.

**Document-defined symbols get their own palette group**, first and counted,
plus a `custom` tag on the row for when a search cuts across groups.
