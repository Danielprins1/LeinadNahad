'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ClientError } from './api';
import { realtimeClient } from './realtime';
import { clearSession, sessionFor, type StoredSession } from './session';
import type { GameView, Role } from '@/lib/types';

/** Vangnet als realtime even niet werkt. */
const POLL_MS_REALTIME = 8000;
const POLL_MS_FALLBACK = 3000;

export type LoadState =
  | { kind: 'loading' }
  | { kind: 'no-session' }
  | { kind: 'ended'; reason: 'invalid' | 'not-found' }
  | { kind: 'ready'; view: GameView };

/**
 * Houdt de spelstatus van dit apparaat actueel:
 * - Supabase Realtime-broadcast "refresh" → opnieuw ophalen
 * - periodiek ophalen als vangnet (en als hartslag voor de verbindingsstatus)
 * - opnieuw ophalen bij terugkeren naar het tabblad of herstel van internet
 */
export function useGame(roomCode: string, role: Role) {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [offline, setOffline] = useState(false);
  const [realtimeUp, setRealtimeUp] = useState(false);

  const seq = useRef(0);
  const applied = useRef(0);

  useEffect(() => {
    const s = sessionFor(roomCode, role);
    if (!s) setState({ kind: 'no-session' });
    setSession(s);
  }, [roomCode, role]);

  const refresh = useCallback(async () => {
    if (!session) return;
    const id = ++seq.current;
    try {
      const view = await api.state(session.roomCode, session.token);
      if (id < applied.current) return; // verouderd antwoord
      applied.current = id;
      setOffline(false);
      setState({ kind: 'ready', view });
    } catch (err) {
      if (id < applied.current) return;
      if (err instanceof ClientError && (err.code === 'UNAUTHORIZED' || err.code === 'GAME_NOT_FOUND')) {
        applied.current = id;
        clearSession();
        setState({ kind: 'ended', reason: err.code === 'UNAUTHORIZED' ? 'invalid' : 'not-found' });
        return;
      }
      setOffline(true); // tijdelijk: we blijven het gewoon opnieuw proberen
    }
  }, [session]);

  // Realtime-abonnement
  useEffect(() => {
    if (!session) return;
    const client = realtimeClient();
    if (!client) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = client
      .channel(`room:${session.roomCode}`)
      .on('broadcast', { event: 'refresh' }, () => {
        // Kleine willekeurige vertraging bundelt snelle updates en spreidt de belasting.
        if (timer) return;
        timer = setTimeout(() => {
          timer = null;
          void refresh();
        }, 80 + Math.random() * 220);
      })
      .subscribe((status) => {
        const up = status === 'SUBSCRIBED';
        setRealtimeUp(up);
        if (up) void refresh(); // na (her)verbinden meteen bijwerken
      });
    return () => {
      if (timer) clearTimeout(timer);
      setRealtimeUp(false);
      void client.removeChannel(channel);
    };
  }, [session, refresh]);

  // Eerste keer laden + polling als vangnet
  useEffect(() => {
    if (!session) return;
    void refresh();
    const interval = setInterval(() => void refresh(), realtimeUp ? POLL_MS_REALTIME : POLL_MS_FALLBACK);
    return () => clearInterval(interval);
  }, [session, refresh, realtimeUp]);

  // Terug in beeld of weer online → direct bijwerken
  useEffect(() => {
    if (!session) return;
    const onWake = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('online', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('online', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [session, refresh]);

  return { session, state, offline, refresh };
}
