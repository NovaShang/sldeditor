---
'sldeditor': minor
---

IEC ⇄ ANSI symbol standard, as a document setting.

Asked for as "give selection of symbol variation. in example for Circuit
breaker, we can select either to use IEC symbol or ANSI". It is a per-DRAWING
switch rather than a per-element one because that is how the choice is really
made: a sheet follows one standard throughout, and one mixing an IEC breaker
with an ANSI one is a mistake, not a feature. `DiagramMeta.symbolStandard`
(absent → `iec`); the picker sits with the label controls in the view menu.

**Switching standards only changes the drawing.** A `LibraryVariant` carries
artwork and frame and nothing else — no terminals, params, state or category —
so pins cannot move, wires cannot re-route, and the compiler sees an identical
model either way. The build script *enforces* it: a variant whose frame does
not still contain the base entry's terminals fails the build. Resolution
happens once, in `compile()`, on the library map every renderer already reads,
which is what keeps the canvas, the SVG/PNG export, the DXF export and the
palette from drifting apart.

**Two symbols actually differ**, both traced from IEEE Std 315-1975 (ANSI
Y32.2-1975) — whose own copyright page grants use of the individual symbols —
and measured off the figures at 300 dpi rather than drawn from memory:

- **Circuit breaker → the square**, §9.4.4. The figure is a true square with
  lead ≈ 0.66 × the side entering dead centre; in this entry's frame that is an
  18-unit square with 11 units of lead. The clause's note says it may be used
  on a power diagram without further identification, which is this exact use.
- **Fuse → the S**, §9.1.1 third alternate. 67 px tall × 27 px wide in the
  standard (2.5 : 1), upper half bowing right and lower half left; here a
  28-unit S, 12 wide. The rectangle forms above it in the same clause are the
  ones the standard marks IEC — they are what this entry already drew.

**Nothing else got a variant, deliberately.** Reading the standard rather than
assuming: its disconnect (§4.6.1), its one-line two-winding transformer
(§6.4.15, the interlocking-circle form) and its instrument transformers are
marked IEC-harmonised — the ANSI and IEC one-line symbols are the same drawing,
and manufacturing a difference would be inventing, not converting. Section 9's
bow form (§9.4.1) is the other admissible ANSI breaker and could be offered
later as a second choice.

The label anchor moves with the drawing (the IEC breaker's sits at x=6, inside
the ANSI square), and `iec` deletes the field rather than storing the word, so
a drawing that never touched the setting still serialises byte-for-byte the way
it did before the setting existed.
