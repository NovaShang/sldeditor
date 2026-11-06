/**
 * Palette search. Every word of the query has to match somewhere, in any
 * order ("push button", "coil contactor"), against the entry's name in the
 * UI language, its English name, the library's own (Chinese) name, its
 * search keywords, its id and its description.
 *
 * Where a word matched decides the order: a symbol whose NAME says "lamp"
 * outranks one whose description happens to mention a fault lamp. Before
 * this, "lamp" listed the 97-98 overload contact and no indicator light at
 * all, and "push button" — two words, not the library's "push-button" —
 * listed nothing.
 */

import type { Locale } from '../i18n';
import { libTextIn } from '../i18n/library';
import type { LibraryEntry } from '../model/library';

/** The texts one entry is searched by, already resolved for the UI language. */
export interface SearchTexts {
  /** Display names: UI language, English, the library's own. */
  names: string[];
  keywords: readonly string[];
  id: string;
  descriptions: string[];
}

/** What `entry` is searched by in a UI language. English names are always
 *  included: engineers type them whatever language the UI is in. */
export function entrySearchTexts(entry: LibraryEntry, locale: Locale): SearchTexts {
  const name = (l: Locale) => libTextIn(l, `${entry.id}.name`, entry.name);
  return {
    names: [name(locale), name('en'), entry.name],
    keywords: entry.keywords ?? [],
    id: entry.id,
    descriptions: [libTextIn(locale, `${entry.id}.desc`, entry.description ?? ''), entry.description ?? ''],
  };
}

const NAME = 3;
const KEYWORD = 2;
const DESCRIPTION = 1;

/** Lower-case, accents dropped ("lámpara" finds "lampara" and back). */
export function normalizeSearch(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** The query's words. Empty when there is nothing to search for. */
export function searchTokens(query: string): string[] {
  return normalizeSearch(query).split(/\s+/).filter(Boolean);
}

/** A field as searched: the text itself plus a copy without separators, so
 *  "pushbutton" finds "Push-button" and "push-button" finds "pushbutton". */
function field(texts: readonly string[]): { text: string; compact: string } {
  const text = normalizeSearch(texts.join(' \u0001 '));
  return { text, compact: text.replace(/[\s\-_/]+/g, '') };
}

/** Inside a word ("lamp" in "clamp") still matches — German compounds and
 *  CJK need that — but ranks a little below a hit at a word start. */
const INNER = 0.25;

/** 1 for a hit at a word start, `1 - INNER` inside a word, 0 for none. */
function hit(f: { text: string; compact: string }, token: string): number {
  let inner = false;
  for (let i = f.text.indexOf(token); i >= 0; i = f.text.indexOf(token, i + 1)) {
    if (i === 0 || !/[\p{L}\p{N}]/u.test(f.text[i - 1])) return 1;
    inner = true;
  }
  if (inner) return 1 - INNER;
  return f.compact.includes(token.replace(/[\s\-_/]+/g, '')) ? 1 : 0;
}

/**
 * How well an entry matches: 0 = not at all, otherwise higher is better. An
 * entry matches when every token is found in some field; it ranks by its
 * weakest token's best field (name > keyword or id > description, a word
 * start a little above the inside of a word). Among
 * name hits, a name that STARTS with a query word wins: "push button" puts
 * "Push-button" ahead of "Stop push-button".
 */
export function searchScore(texts: SearchTexts, tokens: readonly string[]): number {
  if (tokens.length === 0) return 0;
  const names = field(texts.names);
  const keywords = field([...texts.keywords, texts.id]);
  const descriptions = field(texts.descriptions);
  let score = NAME;
  for (const token of tokens) {
    const best = Math.max(
      NAME * hit(names, token),
      KEYWORD * hit(keywords, token),
      DESCRIPTION * hit(descriptions, token),
    );
    if (best === 0) return 0;
    score = Math.min(score, best);
  }
  const leads = (n: string) => tokens.some((t) => normalizeSearch(n).startsWith(t));
  if (score === NAME && texts.names.some(leads)) score += 0.5;
  return score;
}

/**
 * Filter and order a list of entries for a query: matches only, best first,
 * library order among equals.
 */
export function searchEntries(
  entries: readonly LibraryEntry[],
  query: string,
  locale: Locale,
): { entry: LibraryEntry; score: number }[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return [];
  return entries
    .map((entry) => ({ entry, score: searchScore(entrySearchTexts(entry, locale), tokens) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}
