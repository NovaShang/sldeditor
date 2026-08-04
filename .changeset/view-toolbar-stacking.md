---
"sldeditor": patch
---

Raise the view toolbar above host chrome so its Labels popover is usable.

The toolbar container is `absolute z-20`, which makes it a stacking context — so the upward popover added with the label size control could not escape it no matter what z-index the popover itself carried. Any embedding app with its own floating buttons over the bottom-right corner (SmartSLD's help/feedback pills are `fixed z-40`) covered the popover, leaving the segmented mode control and the size stepper unclickable. Found by driving the deployed app, not the editor in isolation, which is why the earlier in-editor testing missed it.

The container is now `z-50`. Host side panels are unaffected: they are expected to move this toolbar aside via `--ole-right-inset` rather than paint over it.
