---
'sldeditor': minor
---

Multi-line equipment names, draggable label blocks, and busduct symbols.

Three of the four requests in the week of 2026-08-29 were about the same
thing — the text beside a symbol is not editable enough to carry what an
engineer needs to write next to a device.

**Enter starts a new row in a name.** `Element.name` could always hold a
newline, but nothing produced one and SVG collapsed it, so a stacked device
tag ("QF1" over "630A/25kA") was impossible. Enter now inserts a line break in
both places a name is typed — the canvas in-place editor and the property
panel's Name field, which became a textarea for the same reason: a name typed
on the canvas used to come back there as one run-on line. Escape, clicking
away and ⌘/Ctrl+Enter commit. Escape keeps its existing meaning (commit, not
cancel) rather than changing under users who already rely on it. Blank lines
are dropped on commit, so a trailing Enter is not a gap.

**Labels can be dragged off their anchor.** New optional
`Element.labelOffset`, in world units, applied on top of the anchor the
library entry declares — the block goes where you drop it and stays there
through rotation and mirroring, because that is what "I moved this
description clear of the wiring" means. Right-click → *Reset label position*
puts it back. The offset is deleted rather than zeroed when a label returns to
its anchor, so a drawing nobody has nudged still serialises byte-for-byte the
way it did before this field existed, and the canvas, SVG/PNG and DXF paths
all read it through the one shared placement function.

The label block only takes pointer events under the select tool, so every
other tool — and read-only mode, which attaches nothing but pan — still clicks
straight through it.

**Busduct (busway).** Two new `busbar`-category symbols converted from IEC
60617-11-17: `busduct` (straight section) and `busduct-tap` (straight section
with a fixed tap-off, which drops below the run where the loads hang). A
busduct run is a two-port element you put in series, not a `Bus`. The elbow
and tee are not included: QET draws them with the origin at a corner of the
run, so canvas rotation would swing them off their own footprint.
