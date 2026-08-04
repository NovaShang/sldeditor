---
"sldeditor": minor
---

Add a **luminaire / lighting-load** element, and make **protection-device ratings render on the canvas**.

Both changes come from reading what users actually draw. Across 163 real diagrams, roughly 70% of all free-annotation objects turned out to be plain text — largely device ratings typed by hand next to a device ("4P 40A 30mA", "3P+N 6A 10kA", "IΔN=0.03A") — and "lighting" was the most-requested symbol that the library genuinely did not have.

**Luminaire** (`luminaire`, category `load`): IEC 60617-11-15-04, the general luminaire symbol. It is deliberately distinct from `indicator-light`, which is chapter 08's signalling lamp — reusing that would have drawn a lighting circuit and a panel pilot lamp identically. QET draws the tube centred on x=5; it is translated 5 units so it centres on the symbol axis, which keeps its single top terminal axis-aligned and therefore out of the W101 jogged-wire diagnostic.

**Ratings on canvas**: the `labelMode: 'all'` mechanism (the default) has always rendered library params flagged `showOnCanvas`, on canvas and in SVG/PNG/DXF export alike — but only 10 of 92 kinds had any param flagged, and they were the power-systems-study symbols (transformer MVA, load MW, busbar kV). The LV protection devices people actually annotate were unreachable: `breaker`, `fuse` and `disconnector` declared no params at all, so their property panel offered nothing to fill in, while `rcd` and `gfci-breaker` exposed `In`/`IDn` fields whose values could never reach a label. Now:

- `breaker` — new `In` (A), `poles` (P), `Icu` (kA)
- `fuse`, `disconnector` — new `In` (A)
- `rcd` (`IDn`), `gfci-breaker` (`In`, `IDn`) — existing params now flagged

No defaults were added, and nothing is retroactive: a param whose value equals its library default is not stored on the element, so existing diagrams gain no labels until someone sets a rating explicitly.
