/**
 * Normalisatie van antwoorden, zodat "New York", "new york", "  NEW   YORK "
 * en "New-York!" als hetzelfde antwoord tellen.
 *
 * Stappen:
 * 1. Unicode-normalisatie (NFKD) en accenten verwijderen (é → e)
 * 2. kleine letters
 * 3. interpunctie en symbolen worden een spatie
 * 4. spaties aan begin/eind weg, meerdere spaties worden één spatie
 */
export function normalizeAnswer(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Namen: hoofdletterongevoelig en spaties opgeschoond, maar leestekens tellen wel mee. */
export function normalizeName(input: string): string {
  return cleanText(input).toLowerCase();
}

/** Opschonen van vrije tekst voor opslag/weergave: geen stuurtekens, enkele spaties. */
export function cleanText(input: string): string {
  return input
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
