import { db } from '@/lib/server/supabase';
import { ApiError, codeFromDbError, handle, ok, readJson } from '@/lib/server/http';
import { cleanRoomCode, hashToken, newToken } from '@/lib/server/tokens';
import { parseName } from '@/lib/server/validation';
import { notifyRoom } from '@/lib/server/realtime';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ code: string }> };

/** Meedoen met een naam. Geeft een geheim spelerstoken terug voor herverbinden. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const roomCode = cleanRoomCode((await ctx.params).code);
  if (!roomCode) throw new ApiError('INVALID_ROOM_CODE');
  const { name, key } = parseName((await readJson(req)).name);
  const playerToken = newToken();

  const { data, error } = await db().rpc('join_game', {
    p_room_code: roomCode,
    p_name: name,
    p_name_key: key,
    p_token_hash: hashToken(playerToken),
  });
  if (error) throw new ApiError(codeFromDbError(error));

  await notifyRoom(roomCode);
  return ok({ roomCode, playerId: data as string, playerToken, name });
});
