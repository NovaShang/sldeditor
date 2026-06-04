---
'sldeditor': minor
---

Expand the element library 47 → 88, sourced from the QElectroTech / IEC 60617 collection via the build pipeline:

- passives: resistor, capacitor, inductor, diode, zener, thyristor, triac, IGBT
- control / signalling: indicator light, push-button, relay coil, NO/NC contacts, bell, buzzer, siren, selector / limit / proximity switch, time relay
- protective relays: overcurrent (50/51), undervoltage (27), reverse-power (32), distance (21), phase-failure, Buchholz (63), general measuring relay
- instruments: power-factor meter, synchronoscope, varmeter, thermocouple
- distribution / misc: terminal-junction, socket-outlet, fuse switch-disconnector, heater, voltage regulator, DC motor
- labelled boxes (no standard IEC symbol): PLC, UPS, switched-mode PSU, genset

Adds `passive` and `control` palette categories. Also fixes text-entity double-escaping in the element build pipeline — relay function glyphs (`U<`, `Z<`, `m<3`) were rendering as literal `&lt;`.
