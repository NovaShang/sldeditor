---
'sldeditor': minor
---

`onToolUse` now also reports the circuit gestures that are not palette tools, each time one completes: `add_contact` (a contact placed via "Add contact"), `quick_insert` (a pick placed from the `/` palette), `insert_on_wire` (a symbol dropped into a conductor), `rail_branch` (a conductor pulled out of a rail) and `rail_hang` (a symbol placed under a rail and wired to it). These events carry `kind: 'gesture'`; tool activations are unchanged. Opening a menu or starting a drag reports nothing.

Power ratings read in the unit that fits: a value below 1 in MW / MVA / Mvar is labelled in kW / kVA / kvar (or W / VA / var), so a 0.006 MW load prints `6kW`. Stored values and their units are unchanged, ratings of 1 and above print as before, and the property panel takes a rating in any unit of its family (unit picker, or a typed suffix such as `6 kW`). `formatParamValue`, `parsePowerInput`, `convertPower`, `displayPowerUnit` and `powerUnitChoices` are exported for hosts.

Text inside a symbol turned 180° (or turned 180° and mirrored) is drawn upright, in the box the turned symbol gives it — on the canvas and in SVG / PNG / PDF and DXF exports. 90° and 270° keep reading from the side.
