/**
 * Alle foutcodes die de server kan teruggeven, met de Nederlandse melding.
 * De codes komen uit de databasefuncties (supabase/migrations) of uit de API-routes.
 */
export const ERROR_MESSAGES = {
  GAME_NOT_FOUND: 'Deze roomcode bestaat niet. Controleer de code en probeer het opnieuw.',
  INVALID_ROOM_CODE: 'Vul een geldige roomcode in.',
  GAME_STARTED: 'Dit spel is al begonnen. Je kunt niet meer meedoen.',
  GAME_FULL: 'Deze room is vol. Er kunnen maximaal 30 spelers meedoen.',
  GAME_CLOSED: 'Dit spel is afgelopen.',
  NAME_TAKEN: 'Deze naam is al in gebruik. Kies een andere naam.',
  INVALID_NAME: 'Vul een naam in van maximaal 20 tekens.',
  INVALID_QUESTIONS: 'Vul minimaal 1 en maximaal 5 vragen in, elk met een juist antwoord.',
  NOT_ENOUGH_PLAYERS: 'Er zijn minimaal 2 spelers nodig om te starten.',
  INVALID_STATE: 'Deze actie is al uitgevoerd of kan nu niet.',
  NO_MORE_QUESTIONS: 'Er zijn geen vragen meer.',
  QUESTIONS_LEFT: 'Er zijn nog vragen over.',
  PHASE_CLOSED: 'Deze fase is al afgelopen.',
  NOT_A_PLAYER: 'Je doet niet (meer) mee aan dit spel.',
  EMPTY_ANSWER: 'Vul een antwoord in.',
  ANSWER_TOO_LONG: 'Je antwoord is te lang (maximaal 80 tekens).',
  CORRECT_ANSWER: 'Dat antwoord kun je niet gebruiken. Verzin een ander antwoord.',
  DUPLICATE_ANSWER: 'Dit antwoord is al gebruikt. Verzin een ander antwoord.',
  ALREADY_SUBMITTED: 'Je hebt al een antwoord ingestuurd.',
  ALREADY_VOTED: 'Je hebt al gestemd.',
  OWN_ANSWER: 'Je kunt niet op je eigen antwoord stemmen.',
  INVALID_OPTION: 'Dit antwoord bestaat niet (meer).',
  UNAUTHORIZED: 'Je sessie is verlopen of ongeldig.',
  FORBIDDEN: 'Alleen de host kan dit doen.',
  BAD_REQUEST: 'Ongeldig verzoek.',
  SERVER_ERROR: 'Er ging iets mis op de server. Probeer het opnieuw.',
  NETWORK_ERROR: 'Geen verbinding met de server. Controleer je internet en probeer het opnieuw.',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && value in ERROR_MESSAGES;
}

export function messageFor(code: ErrorCode): string {
  return ERROR_MESSAGES[code];
}
