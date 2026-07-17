---
"sldeditor": minor
---

Add two elements to the renewable/power-electronics library: **DC/DC converter** and **MPPT controller**. Both use the authoritative IEC 60617 DC/DC-converter symbol (QET `en_60617_06_14_02`) with top→bottom flow — DC/DC converter has generic `t_in`/`t_out` terminals, MPPT has `t_pv` (top) / `t_bat` (bottom). There is no dedicated IEC symbol for an MPPT charge controller; the accepted SLD convention is the DC/DC-converter block distinguished by label. Fills a recurring gap in solar/off-grid single-line diagrams (MPPT and DC-DC chargers previously had to be faked with annotation boxes).
