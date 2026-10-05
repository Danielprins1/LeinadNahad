import { db } from '@/lib/server/supabase';
import { ApiError, codeFromDbError, handle, ok, readJson } from '@/lib/server/http';
import { requirePlayer } from '@/lib/server/session';
import { parseAnswer } from '@/lib/server/validation';
import { notifyRoom } from '@/lib/server/realtime';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ code: string }> };

/**
 * Nepantwoord insturen. Alle controles (fase, juiste antwoord, dubbele
 * antwoorden, één antwoord per speler) gebeuren in de database.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { game, player } = await requirePlayer(req, (await ctx.params).code);
  const { answer, normalized } = parseAnswer((await readJson(req)).answer);

  const { error } = await db().rpc('submit_fake_answer', {
    p_game_id: game.id,
    p_player_id: player.id,
    p_answer: answer,
    p_normalized: normalized,
  });
  if (error) throw new ApiError(codeFromDbError(error));

  await notifyRoom(game.room_code);
  return ok({ answer });
});
