# sldeditor

## 0.0.2

### Patch Changes

- [`cf59604`](https://github.com/NovaShang/sldeditor/commit/cf596043472caec8572b5491ac199992809d9ad2) Thanks [@NovaShang](https://github.com/NovaShang)! - Include element labels and free text annotations in SVG/PNG exports — previously only DXF carried them, leaving the raster/vector outputs missing the IDs, showOnCanvas params, and any notes the user dropped via the text tool. `downloadSvg` / `downloadPng` now honor `labelMode` and accept an `annotations` array (defaults wired through `ExportMenu`). Label/annotation positioning matches the canvas exactly because all three surfaces — `AnnotationLayer`, DXF, SVG — now share a single helper module.
