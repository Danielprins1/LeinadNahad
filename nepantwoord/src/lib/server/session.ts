import 'server-only';
import { db } from './supabase';
import { ApiError } from './http';
import { hashToken, cleanRoomCode } from './tokens';
import type { GameStatus } from '@/lib/types';

export interface GameRow {
  id: string;
  room_code: string;
  status: GameStatus;
  current_question: number;
}

export interface PlayerRow {
  id: string;
  game_id: string;
  name: string;
  score: number;
  last_seen_at: string;
}

export type Session =
  | { role: 'host'; game: GameRow }
  | { role: 'player'; game: GameRow; player: PlayerRow };

function bearer(req: Request): string | null {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

export async function loadGame(codeParam: string): Promise<GameRow & { host_token_hash: string }> {
  const code = cleanRoomCode(codeParam);
  if (!code) throw new ApiError('GAME_NOT_FOUND');
  const { data, error } = await db()
    .from('games')
    .select('id, room_code, status, current_question, host_token_hash')
    .eq('room_code', code)
    .maybeSingle();
  if (error) throw new ApiError('SERVER_ERROR');
  if (!data) throw new ApiError('GAME_NOT_FOUND');
  return data as GameRow & { host_token_hash: string };
}

/**
 * Bepaalt wie het verzoek doet op basis van het geheime token.
 * Het token van de host en van iedere speler is alleen bekend bij dat apparaat.
 */
export async function resolveSession(req: Request, codeParam: string): Promise<Session> {
  const token = bearer(req);
  if (!token) throw new ApiError('UNAUTHORIZED');
  const hash = hashToken(token);
  const { host_token_hash, ...game } = await loadGame(codeParam);

  if (hash === host_token_hash) return { role: 'host', game };

  const { data, error } = await db()
    .from('players')
    .select('id, game_id, name, score, last_seen_at')
    .eq('game_id', game.id)
    .eq('token_hash', hash)
    .maybeSingle();
  if (error) throw new ApiError('SERVER_ERROR');
  if (!data) throw new ApiError('UNAUTHORIZED');
  return { role: 'player', game, player: data as PlayerRow };
}

export async function requireHost(req: Request, code: string) {
  const session = await resolveSession(req, code);
  if (session.role !== 'host') throw new ApiError('FORBIDDEN');
  return session;
}

export async function requirePlayer(req: Request, code: string) {
  const session = await resolveSession(req, code);
  if (session.role !== 'player') throw new ApiError('FORBIDDEN');
  return session;
}
