---
"sldeditor": minor
---

Non-bus-first onboarding + crossing-vs-connecting wire gaps

**Onboarding.** The first-run card no longer teaches "draw a busbar first". It now leads with the general flow — place a component → wire pins together (drag into empty space to drop a junction) → reach for a busbar only when several circuits share one rail — matching the free-wire / junction model.

**Crossing ≠ connecting.** Where two wires of different electrical nodes cross with no junction, the under-wire is now drawn with a small gap at the crossing, so a crossover reads unambiguously as *not connected*. A junction dot remains the only "connected" signal. Hit-testing/selection still spans the whole wire (the gap is visual only).
