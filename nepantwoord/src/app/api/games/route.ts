import { db } from '@/lib/server/supabase';
import { ApiError, codeFromDbError, handle, ok, readJson } from '@/lib/server/http';
import { hashToken, newRoomCode, newToken } from '@/lib/server/tokens';
import { parseQuestions } from '@/lib/server/validation';

export const dynamic = 'force-dynamic';

/** Spel aanmaken. Wie dit doet, krijgt het (geheime) hosttoken. */
export const POST = handle(async (req: Request) => {
  const body = await readJson(req);
  const questions = parseQuestions(body.questions);
  const hostToken = newToken();

  // Bij een (zeldzame) botsing van de roomcode gewoon een nieuwe proberen.
  for (let attempt = 0; attempt < 8; attempt++) {
    const roomCode = newRoomCode();
    const { error } = await db().rpc('create_game', {
      p_room_code: roomCode,
      p_host_token_hash: hashToken(hostToken),
      p_questions: questions,
    });
    if (!error) {
      await cleanupOldGames();
      return ok({ roomCode, hostToken });
    }
    if (error.code !== '23505') throw new ApiError(codeFromDbError(error));
  }
  throw new ApiError('SERVER_ERROR');
});

/** Spellen ouder dan 2 dagen opruimen (inclusief spelers, antwoorden en stemmen). */
async function cleanupOldGames() {
  const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await db().from('games').delete().lt('updated_at', cutoff);
  if (error) console.warn('Opruimen van oude spellen mislukt:', error.message);
}
