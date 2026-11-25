/**
 * Power ratings in W / kW / MW and VA / kVA / MVA. The stored unit of a param
 * is the library's and never changes (the generic load's P is MW); a small
 * mega-unit value is SHOWN in the smaller unit, and typed values in any unit
 * of the family are converted back to the stored one.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';
import { compile } from '../../src/compiler';
import { labelLines } from '../../src/lib/element-labels';
import { buildExportSvg } from '../../src/lib/export-image';
import { buildExportDxf } from '../../src/lib/export-dxf';
import {
  convertPower,
  displayPowerUnit,
  formatParamValue,
  parsePowerInput,
  powerUnitChoices,
} from '../../src/lib/power-units';
import type { DiagramFile } from '../../src/model';

const one = (kind: string, params: Record<string, number>, name?: string): DiagramFile => ({
  version: '1',
  elements: [{ id: 'X1', kind, params, ...(name ? { name } : {}) }],
  layout: { X1: { at: [0, 0] } },
});

const lines = (d: DiagramFile) => labelLines(compile(d).elements.get('X1')!, 'all');

describe('formatParamValue', () => {
  it('spells a small MW / MVA / Mvar value out in the smaller unit', () => {
    expect(formatParamValue(0.006, 'MW')).toBe('6kW');
    expect(formatParamValue(0.006, 'MVA')).toBe('6kVA');
    expect(formatParamValue(0.63, 'MVA')).toBe('630kVA');
    expect(formatParamValue(0.0005, 'MW')).toBe('500W');
    expect(formatParamValue(0.12, 'Mvar')).toBe('120kvar');
  });

  it('leaves ratings of 1 and more, and non-mega units, exactly as before', () => {
    expect(formatParamValue(240, 'MVA')).toBe('240MVA');
    expect(formatParamValue(2.5, 'MW')).toBe('2.5MW');
    expect(formatParamValue(1, 'MW')).toBe('1MW');
    expect(formatParamValue(0.75, 'kW')).toBe('0.75kW');
    expect(formatParamValue(1500, 'kW')).toBe('1500kW');
    expect(formatParamValue(0, 'MW')).toBe('0MW');
    expect(formatParamValue(10.5, 'kV')).toBe('10.5kV');
    expect(formatParamValue('abc', 'MW')).toBe('abcMW');
    expect(formatParamValue(5, undefined)).toBe('5');
  });

  it('carries no float dust', () => {
    expect(formatParamValue(0.0007, 'MW')).toBe('700W');
    expect(formatParamValue(0.0123, 'MVA')).toBe('12.3kVA');
  });
});

describe('labels', () => {
  it('a 6 kW load stored as 0.006 MW labels as 6kW, on canvas, SVG and DXF', () => {
    const d = one('load', { P: 0.006 });
    expect(lines(d)).toEqual(['X1', '6kW']);
    expect(buildExportSvg(compile(d))).toContain('>6kW<');
    expect(buildExportDxf(compile(d))).toContain('\n6kW\n');
    // The stored value is untouched.
    expect(d.elements[0].params).toEqual({ P: 0.006 });
  });

  it('a 630 kVA transformer labels as 630kVA; a 40 MVA one as before', () => {
    expect(lines(one('transformer-2w', { S: 0.63 }))).toContain('630kVA');
    expect(lines(one('transformer-2w', { S: 40 }))).toContain('40MVA');
  });

  it('an explicit name is never rewritten', () => {
    expect(lines(one('load', { P: 9 }, 'LP1 6 kVA'))).toEqual(['LP1 6 kVA', '9MW']);
  });
});

describe('entry', () => {
  it('offers the family of the stored unit', () => {
    expect(powerUnitChoices('MW')).toEqual(['W', 'kW', 'MW']);
    expect(powerUnitChoices('kVA')).toEqual(['VA', 'kVA', 'MVA']);
    expect(powerUnitChoices('kV')).toBeNull();
    expect(powerUnitChoices(undefined)).toBeNull();
  });

  it('shows a stored value in the unit the label uses', () => {
    expect(displayPowerUnit(0.006, 'MW')).toBe('kW');
    expect(displayPowerUnit(3, 'MW')).toBe('MW');
    expect(displayPowerUnit(undefined, 'MW')).toBe('MW');
    expect(displayPowerUnit(0.5, 'kW')).toBe('kW');
  });

  it('converts between units of a family', () => {
    expect(convertPower(6, 'kW', 'MW')).toBe(0.006);
    expect(convertPower(0.006, 'MW', 'kW')).toBe(6);
    expect(convertPower(630, 'kVA', 'MVA')).toBe(0.63);
    expect(convertPower(5, 'kW', 'kVA')).toBe(5); // other family: untouched
  });

  it('parses a typed value in the chosen unit or with its own suffix', () => {
    expect(parsePowerInput('6', 'kW', 'MW')).toBe(0.006);
    expect(parsePowerInput('6 kW', 'MW', 'MW')).toBe(0.006);
    expect(parsePowerInput('6kva', 'MVA', 'MVA')).toBe(0.006);
    expect(parsePowerInput('2.5', 'MVA', 'MVA')).toBe(2.5);
    expect(parsePowerInput('1e3', 'W', 'kW')).toBe(1);
    expect(parsePowerInput('6 kV', 'kW', 'MW')).toBeNull();
    expect(parsePowerInput('6 kVA', 'kW', 'MW')).toBeNull();
    expect(parsePowerInput('six', 'kW', 'MW')).toBeNull();
  });
});
