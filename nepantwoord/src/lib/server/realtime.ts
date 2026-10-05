import 'server-only';
import { supabaseUrl } from './supabase';

export function roomChannel(roomCode: string): string {
  return `room:${roomCode}`;
}

/**
 * Seint alle apparaten in de room dat er iets veranderd is.
 * Het bericht bevat bewust GEEN speldata: iedere client haalt daarna zijn
 * eigen, gefilterde weergave op via /api/games/[code]/state. Zo kan er via
 * realtime nooit een geheim (zoals het juiste antwoord) uitlekken.
 */
export async function notifyRoom(roomCode: string): Promise<void> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  try {
    const res = await fetch(`${supabaseUrl()}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        // Oude (JWT) service-role-keys ook als Bearer; nieuwe sb_secret_-keys alleen als apikey.
        ...(key.startsWith('sb_') ? {} : { Authorization: `Bearer ${key}` }),
      },
      body: JSON.stringify({
        messages: [{ topic: roomChannel(roomCode), event: 'refresh', payload: { at: Date.now() } }],
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) console.warn('Realtime-broadcast mislukt:', res.status, await res.text());
  } catch (err) {
    // Niet fataal: clients pollen als vangnet.
    console.warn('Realtime-broadcast mislukt:', err);
  }
}
