---
"sldeditor": patch
---

Fix DXF export producing files no CAD reader can open.

The writer declared `$ACADVER = AC1009` (AutoCAD R12) and then emitted
`LWPOLYLINE`, an entity that did not exist until R14, without the
`AcDbEntity`/`AcDbPolyline` subclass markers R13+ readers require. Every reader
lost: one honouring the header skipped the entity — and since every wire and bus
is a polyline, the electrical content simply vanished — while one going by
entity type rejected the whole file. `ezdxf` raises `DXFStructureError` and
cannot even recover it. Users saw it as "the DXF I downloaded is blank".

Polylines are now emitted as R12 `POLYLINE`/`VERTEX`/`SEQEND` with the required
`66` flag, preserving the closed bit. `$ACADVER` stays `AC1009`, which is the
honest declaration: the rest of the file is R12-shaped, with no BLOCKS section
and no entity handles, so promoting the version would mean adding handles
everywhere.

Also writes `$EXTMIN`/`$EXTMAX`, which were never emitted. With no stored
extents and no VPORT table a CAD app opens on a default window near the origin;
single-line diagrams commonly sit at negative Y and run well past x = 1000, so
the drawing was off-screen on open — the other thing users mean by "blank". A
drawing with no finite geometry gets no extents at all rather than a fabricated
rectangle.

Verified against `ezdxf` on a real 55-element diagram: 401 entities, 56 on the
WIRES layer, extents `(50, -693.75) → (1450, 40)`, zero audit errors.
