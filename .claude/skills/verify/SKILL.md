---
name: verify
description: Build, launch, and drive the sldeditor demo app to verify editor changes end-to-end (canvas gestures, properties panel, exports).
---

# Verify sldeditor changes

## Launch

```bash
# BROWSER=none stops vite from opening the user's desktop browser
BROWSER=none npm run dev        # vite on :5173, demo app with sample diagram
```

Headless driving works well with Python Playwright via the global
webapp-testing skill's `with_server.py`:

```bash
BROWSER=none python3 ~/.claude/skills/webapp-testing/scripts/with_server.py \
  --server "npm run dev" --port 5173 -- python3 your_script.py
```

## Driving the canvas (selectors + gotchas)

- Wires: `polyline.ole-wire-hit[data-wire-id]` — the wide invisible hit
  polyline. Its `points` are SVG **world** coords; convert to screen via
  `poly.getScreenCTM()` + `svg.createSVGPoint()` before `page.mouse.click`.
  Clicking the locator's bbox center misses L-shaped wires.
- Elements: `g[data-element-id]` — `getBoundingClientRect()` center is
  draggable with `mouse.down/move/up` (pointer events fire).
- Structural labels (element + wire): `.ole-annotation-text`.
- Properties panel inputs commit on Enter/blur (name/label) or debounced
  autosave (note textarea).
- Sample diagram wires are all vertical (tree layout + bus projection).
  To force a horizontal wire run: drag a *device* (not the bus) sideways
  past the bus span so auto-route's L gains a long horizontal leg.
- Undo/redo: `Meta+z` / `Meta+Shift+z`.
- Exports: top-bar "Export" button → menu items ("SVG" etc.); capture with
  `page.expect_download()` and read the file.
- The "Quick start" onboarding card shows on first load; it does not
  intercept canvas clicks outside its box, but dismiss via its "Got it"
  button if you need the center of the canvas.

## Fast checks (not verification, just gates)

```bash
npm run test        # vitest, tests/
npm run typecheck   # both tsconfigs
npm run build:lib   # publishable bundle + d.ts (check dist/**/*.d.ts)
```
