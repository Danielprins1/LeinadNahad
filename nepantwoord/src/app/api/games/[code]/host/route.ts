import { db } from '@/lib/server/supabase';
import { ApiError, codeFromDbError, handle, ok, readJson } from '@/lib/server/http';
import { requireHost } from '@/lib/server/session';
import { notifyRoom } from '@/lib/server/realtime';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ code: string }> };

/** Hostacties → databasefunctie. Iedere functie controleert zelf de huidige fase. */
const ACTIONS = {
  start: 'start_game',
  openVoting: 'open_voting',
  reveal: 'reveal_answers',
  scoreboard: 'show_scoreboard',
  nextQuestion: 'next_question',
  finish: 'finish_game',
  restart: 'restart_game',
  close: 'close_game',
  kick: 'kick_player',
} as const;

type Action = keyof typeof ACTIONS;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Alleen wie het hosttoken heeft, komt hier voorbij requireHost(). */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { game } = await requireHost(req, (await ctx.params).code);
  const body = await readJson(req);
  const action = body.action;
  if (typeof action !== 'string' || !(action in ACTIONS)) throw new ApiError('BAD_REQUEST');

  const args: Record<string, string> = { p_game_id: game.id };
  if (action === 'kick') {
    if (typeof body.playerId !== 'string' || !UUID.test(body.playerId)) throw new ApiError('BAD_REQUEST');
    args.p_player_id = body.playerId;
  }

  const { error } = await db().rpc(ACTIONS[action as Action], args);
  if (error) throw new ApiError(codeFromDbError(error));

  await notifyRoom(game.room_code);
  return ok({ done: true });
});
