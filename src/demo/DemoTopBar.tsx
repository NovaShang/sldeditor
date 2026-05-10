/**
 * Demo-only chrome: file open/save/save-as, image export, theme toggle.
 *
 * Lives in `src/demo/` rather than the editor library because real consumers
 * usually own their persistence layer. The library exposes `<FileMenu />` and
 * `<ExportMenu />` separately so embedding apps can compose them into their
 * own toolbar; this demo just stitches them together with a theme + locale
 * toggle.
 */

import { Languages, Moon, Sun } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Tooltip } from '../components/ui/tooltip';
import { ExportMenu } from '../components/ExportMenu';
import { FileMenu } from '../components/FileMenu';
import { useTheme } from '../hooks/use-theme';
import { useLocale, useT } from '../i18n';

export function DemoTopBar() {
  const t = useT();
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';

  return (
    <div
      className="absolute z-20"
      style={{
        top: 'calc(0.75rem + var(--ole-top-inset, 0px))',
        left: 'calc(0.75rem + var(--ole-left-inset, 0px))',
      }}
    >
      <div className="ole-glass flex items-center gap-0.5 rounded-2xl border border-border p-1.5 shadow-sm">
        <FileMenu />
        <ExportMenu />
        <div aria-hidden className="mx-1 h-4 w-px bg-border" />
        <LocaleToggle />
        <Tooltip
          content={
            <div className="space-y-0.5">
              <div className="font-medium">
                {isDark ? t('topbar.theme.toLight') : t('topbar.theme.toDark')}
              </div>
              <div className="text-muted-foreground">
                {isDark
                  ? t('topbar.theme.currentDark')
                  : t('topbar.theme.currentLight')}
              </div>
            </div>
          }
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              isDark ? t('topbar.theme.toLight') : t('topbar.theme.toDark')
            }
            aria-pressed={isDark}
            onClick={toggle}
          >
            {isDark ? <Sun /> : <Moon />}
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

function LocaleToggle() {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const toggle = useLocale((s) => s.toggle);
  const isZh = locale === 'zh';
  return (
    <Tooltip
      content={
        <div className="space-y-0.5">
          <div className="font-medium">
            {isZh ? t('topbar.lang.toEnglish') : t('topbar.lang.toChinese')}
          </div>
          <div className="text-muted-foreground">
            {isZh
              ? t('topbar.lang.currentChinese')
              : t('topbar.lang.currentEnglish')}
          </div>
        </div>
      }
    >
      <Button
        variant="ghost"
        size="icon"
        aria-label={
          isZh ? t('topbar.lang.toEnglish') : t('topbar.lang.toChinese')
        }
        onClick={toggle}
      >
        <Languages />
      </Button>
    </Tooltip>
  );
}
