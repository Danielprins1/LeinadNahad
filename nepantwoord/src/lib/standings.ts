import type { Standing } from './types';

/**
 * Sorteert op punten (hoog → laag) en geeft gelijke scores dezelfde plaats
 * (1, 2, 2, 4, ...). Bij gelijke stand op alfabet.
 */
export function rankStandings(players: { id: string; name: string; score: number }[]): Standing[] {
  const sorted = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'nl'));
  let rank = 0;
  return sorted.map((p, i) => {
    if (i === 0 || p.score !== sorted[i - 1].score) rank = i + 1;
    return { id: p.id, name: p.name, score: p.score, rank };
  });
}
