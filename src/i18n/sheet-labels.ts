/**
 * Title-block field names and the "sheet n of N" text in the current
 * locale, for every renderer of a sheet (canvas, SVG/PNG/PDF/DXF export). One
 * place, so the page on paper says exactly what the frame on screen says.
 */

import { t } from './index';
import type { SheetFieldLabels } from '../model/sheet-render';

export function sheetFieldLabels(): SheetFieldLabels {
  return {
    project: t('sheet.field.project'),
    client: t('sheet.field.client'),
    title: t('sheet.field.title'),
    number: t('sheet.field.number'),
    designer: t('sheet.field.designer'),
    checker: t('sheet.field.checker'),
    date: t('sheet.field.date'),
    scaleText: t('sheet.field.scaleText'),
    sheetNo: t('sheet.field.sheetNo'),
  };
}

/** "第 2 张 / 共 3 张" / "2 of 3". */
export function sheetOfText(n: number, total: number): string {
  return t('sheet.sheetOf', { n, N: total });
}
