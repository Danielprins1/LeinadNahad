export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 30;
export const MIN_QUESTIONS = 1;
export const MAX_QUESTIONS = 5;

export const MAX_NAME_LENGTH = 20;
export const MAX_QUESTION_LENGTH = 300;
export const MAX_ANSWER_LENGTH = 80;

export const POINTS_CORRECT_GUESS = 2;
export const POINTS_PER_FOOLED_PLAYER = 1;

/** Een speler geldt als verbonden als hij in deze periode nog iets van zich liet horen. */
export const CONNECTED_WINDOW_MS = 15_000;

/** Tekens voor de roomcode: zonder verwarrende tekens zoals 0/O en 1/I. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;

/** Werktitel; vervang door de definitieve naam. */
export const APP_NAME = 'Nepantwoord';
