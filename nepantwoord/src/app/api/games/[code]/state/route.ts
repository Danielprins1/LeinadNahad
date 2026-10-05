import { handle, ok } from '@/lib/server/http';
import { resolveSession } from '@/lib/server/session';
import { buildView } from '@/lib/server/state';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ code: string }> };

/** De actuele, per deelnemer gefilterde spelstatus. */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const session = await resolveSession(req, (await ctx.params).code);
  return ok(await buildView(session));
});
