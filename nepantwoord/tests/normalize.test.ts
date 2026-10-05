import { describe, expect, it } from 'vitest';
import { normalizeAnswer, normalizeName, cleanText } from '@/lib/normalize';
import { rankStandings } from '@/lib/standings';

describe('normalizeAnswer', () => {
  it('behandelt varianten van hetzelfde antwoord gelijk', () => {
    const variants = ['New York', 'new york', ' NEW YORK ', 'New   York', 'new-york', 'New York!', 'New York.'];
    for (const v of variants) expect(normalizeAnswer(v)).toBe('new york');
  });
  it('negeert accenten', () => {
    expect(normalizeAnswer('Népal')).toBe(normalizeAnswer('nepal'));
    expect(normalizeAnswer('Curaçao')).toBe('curacao');
  });
  it('houdt cijfers en letters', () => {
    expect(normalizeAnswer('  1984 ')).toBe('1984');
    expect(normalizeAnswer("Rock 'n' Roll")).toBe('rock n roll');
  });
  it('alleen leestekens wordt leeg', () => {
    expect(normalizeAnswer('?!...')).toBe('');
  });
});

describe('normalizeName / cleanText', () => {
  it('namen hoofdletter- en spatie-ongevoelig', () => {
    expect(normalizeName('  Daniel ')).toBe(normalizeName('daniel'));
    expect(normalizeName('Jan  Piet')).toBe('jan piet');
  });
  it('verwijdert stuurtekens', () => {
    expect(cleanText('a\u0000b\nc')).toBe('a b c');
  });
});

describe('rankStandings', () => {
  it('sorteert op punten en deelt plaatsen bij gelijke stand', () => {
    const r = rankStandings([
      { id: 'a', name: 'Anna', score: 4 },
      { id: 'b', name: 'Bram', score: 10 },
      { id: 'c', name: 'Cas', score: 4 },
      { id: 'd', name: 'Dirk', score: 1 },
    ]);
    expect(r.map((s) => [s.name, s.rank])).toEqual([
      ['Bram', 1],
      ['Anna', 2],
      ['Cas', 2],
      ['Dirk', 4],
    ]);
  });
});
