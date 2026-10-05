import { db } from '@/lib/server/supabase';
import { ApiError, codeFromDbError, handle, ok, readJson } from '@/lib/server/http';
import { requirePlayer } from '@/lib/server/session';
import { notifyRoom } from '@/lib/server/realtime';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ code: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stemmen op het antwoord dat volgens de speler echt is. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { game, player } = await requirePlayer(req, (await ctx.params).code);
  const optionId = (await readJson(req)).optionId;
  if (typeof optionId !== 'string' || !UUID.test(optionId)) throw new ApiError('INVALID_OPTION');

  const { error } = await db().rpc('cast_vote', {
    p_game_id: game.id,
    p_player_id: player.id,
    p_option_id: optionId,
  });
  if (error) throw new ApiError(codeFromDbError(error));

  await notifyRoom(game.room_code);
  return ok({ optionId });
});
