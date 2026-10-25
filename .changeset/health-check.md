---
"sldeditor": minor
---

Drawing health check. The editor now reads the topology the drawing already has and shows what a picture cannot: devices and buses with no wire, wires that end on a terminal or busbar without being joined to it ("looks connected, isn't"), devices with no path to a supply, a supply that feeds nothing, voltage levels joined without a transformer, transformer ratios that disagree with their buses, names that contradict their ratings, and load totals with transformer/UPS loading (overload past 125%, honest about loads without a rating). Markers sit on the canvas (never in exports), a Checks panel in the view toolbar lists everything, and "Intentional" dismissals are stored in `meta.healthDismissed`. `checkHealth(diagram, internal)` is exported for hosts; `onHealthEvent` reports opens/dismissals. Motors, EV chargers, sockets and luminaires gain a `P` (kW) parameter. Rules were tuned on real drawings to ≤ 10% false alarms.
