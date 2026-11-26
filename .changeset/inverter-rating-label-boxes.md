---
'sldeditor': minor
---

Inverters get a rated power, and hosts can read where element labels are drawn.

- `inverter` has a `Prated` param (rated AC output, stored in MW, shown on the label): `0.005` prints `5kW`, `2.5` prints `2.5MW`, and the property panel takes it in W / kW / MW or with a typed unit. It is a new key, so anything a drawing already keeps in an inverter's params — under any name, `P` included — renders exactly as before.
- `elementLabelBoxes(model, { labelMode, labelFontSize, sheets })` returns each element label's world rectangle, placed exactly as the canvas and exporters place it, with full-width CJK characters measured at one em. For hosts checking labels for collisions.
