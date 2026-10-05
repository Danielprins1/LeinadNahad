/** Spelstatussen. De host bepaalt altijd de overgang. */
export type GameStatus =
  | 'LOBBY'
  | 'SUBMITTING_ANSWERS'
  | 'VOTING'
  | 'REVEAL'
  | 'SCOREBOARD'
  | 'FINISHED'
  | 'CLOSED';

export type Role = 'host' | 'player';

export interface PlayerSummary {
  id: string;
  name: string;
  connected: boolean;
}

export interface Standing {
  id: string;
  name: string;
  score: number;
  rank: number;
}

export interface ProgressEntry {
  id: string;
  name: string;
  done: boolean;
}

/** Antwoordoptie in de stemfase. Bevat bewust géén auteur en géén "is juist". */
export interface VotingOption {
  id: string;
  text: string;
  /** Alleen voor de speler zelf: dit is zijn eigen nepantwoord. */
  isOwn?: boolean;
}

export interface RevealOption {
  id: string;
  text: string;
  isCorrect: boolean;
  author: { id: string; name: string } | null;
  voters: { id: string; name: string }[];
  /** Punten die de auteur verdient met dit nepantwoord. */
  authorPoints: number;
}

export interface RevealData {
  correctAnswer: string;
  options: RevealOption[];
  roundPoints: { id: string; name: string; points: number }[];
}

export interface QuestionInfo {
  number: number; // 1-based
  total: number;
  text: string;
}

/** Wat iedere deelnemer van de server krijgt. Altijd gefilterd per rol. */
export interface GameView {
  role: Role;
  roomCode: string;
  status: GameStatus;
  maxPlayers: number;
  minPlayers: number;
  questionCount: number;
  players: PlayerSummary[];
  me: { id: string; name: string; score: number } | null;
  question: QuestionInfo | null;

  /** SUBMITTING_ANSWERS */
  myAnswer?: string | null;
  answerProgress?: ProgressEntry[];

  /** VOTING */
  options?: VotingOption[];
  myVoteOptionId?: string | null;
  voteProgress?: ProgressEntry[];

  /** REVEAL */
  reveal?: RevealData;

  /** SCOREBOARD / FINISHED (en REVEAL) */
  standings?: Standing[];
  isLastQuestion?: boolean;
}

/** Concept-vraag in het aanmaakscherm van de host. */
export interface QuestionDraft {
  key: string;
  question: string;
  correctAnswer: string;
}
