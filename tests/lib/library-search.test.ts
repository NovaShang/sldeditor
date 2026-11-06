/**
 * Palette search: every word matches in any order, the words people actually
 * type find the symbol they mean (keywords), a name hit outranks a passing
 * mention in a description, the drawing type's filter applies, and search in
 * the other UI languages keeps working.
 */

import { describe, expect, it } from 'vitest';
import { libraryEntries } from '../../src/element-library';
import { entryFitsDiagramType } from '../../src/model/diagram-type';
import type { DiagramType } from '../../src/model';
import type { Locale } from '../../src/i18n';
import { searchEntries, searchScore, searchTokens } from '../../src/lib/library-search';

/** Ids found for `query` in a drawing type's palette, best first. */
function find(query: string, type: DiagramType = 'circuit', locale: Locale = 'en'): string[] {
  const palette = libraryEntries.filter(
    (e) => e.id !== 'busbar' && entryFitsDiagramType(e, type),
  );
  return searchEntries(palette, query, locale).map((r) => r.entry.id);
}

describe('library search', () => {
  it('matches every word, in any order, across separators', () => {
    expect(find('push button')[0]).toBe('push-button');
    expect(find('button push')[0]).toBe('push-button');
    expect(find('pushbutton')).toContain('push-button');
    expect(find('stop button')[0]).toBe('push-button-break');
    expect(find('push banana')).toEqual([]);
  });

  it('finds what people call things', () => {
    expect(find('lamp')[0]).toBe('indicator-light');
    expect(find('pilot light')[0]).toBe('indicator-light');
    expect(find('timer')[0]).toBe('time-relay');
    expect(find('coil')[0]).toBe('relay-coil');
    expect(find('contactor coil')[0]).toBe('relay-coil');
    expect(find('e-stop')[0]).toBe('emergency-stop');
    expect(find('emergency')[0]).toBe('emergency-stop');
    expect(find('overload')).toEqual(expect.arrayContaining(['overload-relay-3p', 'thermal-overload']));
    expect(find('mcb')).toContain('mcb-1pn');
    expect(find('breaker')).toEqual(expect.arrayContaining(['breaker-3p', 'mcb-1pn', 'motor-breaker-3p']));
    expect(find('terminal')).toEqual(expect.arrayContaining(['terminal-block', 'terminal']));
  });

  it('ranks a name hit above a description that only mentions the word', () => {
    const hits = find('lamp');
    expect(hits.indexOf('indicator-light')).toBeLessThan(hits.indexOf('overload-contact-make'));
    // Nothing whose words merely contain the letters (cLAMP, sCOIL) leads.
    expect(find('coil')[0]).toBe('relay-coil');
    expect(hits.slice(0, 2)).not.toContain('terminal-block');
  });

  it('applies the same drawing-type filter as browsing', () => {
    expect(find('busduct', 'circuit')).toEqual([]);
    expect(find('distance', 'circuit')).not.toContain('distance-relay');
    expect(find('busduct', 'sld')).toContain('busduct');
    expect(find('breaker', 'sld')).not.toContain('breaker-3p');
  });

  it('searches in the UI language, and in English from any of them', () => {
    expect(find('按钮', 'circuit', 'zh')).toContain('push-button');
    expect(find('指示灯', 'circuit', 'zh')[0]).toBe('indicator-light');
    expect(find('лампа', 'circuit', 'ru')[0]).toBe('indicator-light');
    expect(find('реле времени', 'circuit', 'ru')[0]).toBe('time-relay');
    expect(find('pulsador', 'circuit', 'es')).toContain('push-button');
    // Accents optional.
    expect(find('lampara', 'circuit', 'es')[0]).toBe('indicator-light');
    expect(find('Zeitrelais', 'circuit', 'de')[0]).toBe('time-relay');
    expect(find('timer', 'circuit', 'de')[0]).toBe('time-relay');
  });

  it('scores nothing for an empty query', () => {
    expect(searchTokens('   ')).toEqual([]);
    expect(searchScore({ names: ['x'], keywords: [], id: 'x', descriptions: [] }, [])).toBe(0);
  });
});
