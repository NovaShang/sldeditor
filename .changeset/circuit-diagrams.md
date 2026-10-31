---
"sldeditor": minor
---

Circuit diagrams. A document can now be a single-line diagram or an IEC circuit diagram (`meta.diagramType: 'circuit'`), switched from the view settings.

- On circuit diagrams, pin designations (A1/A2, 13/14, 95/96, 1/3/5 → 2/4/6, U/V/W …) appear next to every terminal, solder dots mark every T at a pin or bus tap, and the toolbar offers **Number wires** (wire numbers by potential) in place of auto-layout.
- 16 new symbols: 3-phase supply, 3-pole breaker / motor-protection breaker / fuse / switch-disconnector / contactor main poles / overload relay, 3-phase motor, 4-pole RCD, 1P+N MCB, terminal block, stop push-button, emergency stop, NC limit switch, overload auxiliary contacts. Existing coils, contacts, push-buttons and lamps carry IEC pin designations.
- Wire inspector: one-click conductor presets L1 / L2 / L3 / N / PE (IEC 60445 colours; PE drawn green-yellow). Element properties: editable pin numbers per instance.
- Health checks follow the drawing type: circuit diagrams check contacts against their coils by device tag instead of supply and loads.
- `indicator-light` now has proper leads: its lower terminal moved from the circle's edge to the end of the lead (20 units lower), so wires attached to it re-route slightly.

Single-line diagrams render and export exactly as before.
