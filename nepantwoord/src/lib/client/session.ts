'use client';

import type { Role } from '@/lib/types';

/**
 * De sessie van dit apparaat (host of speler) wordt in localStorage bewaard,
 * zodat je na verversen of wegvallen automatisch terugkeert in hetzelfde spel.
 */
export interface StoredSession {
  role: Role;
  roomCode: string;
  token: string;
  playerId?: string;
  name?: string;
}

const KEY = 'nepantwoord.sessie';

export function loadSession(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    return parsed?.token && parsed?.roomCode ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* privémodus e.d.: het spel werkt, alleen herverbinden na verversen niet */
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* negeren */
  }
}

export function sessionFor(roomCode: string, role: Role): StoredSession | null {
  const s = loadSession();
  return s && s.roomCode === roomCode.toUpperCase() && s.role === role ? s : null;
}
