---
"sldeditor": minor
---

Expand localization from 2 to 11 languages. Adds Spanish, French, German, Portuguese, Japanese, Russian, Persian (Farsi), Arabic, and Hebrew alongside the existing English and Chinese, covering both the UI strings and the electrical component library. Non-canonical locales are partial and fall back to **English** (previously the fallback was Chinese). The active locale is still driven by the host via the `locale` prop / `useLocale`; `navigator.language` auto-detection now maps to any supported locale. RTL languages (fa/ar/he) render translated text in the existing LTR layout.
