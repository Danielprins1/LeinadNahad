'use client';

import { ERROR_MESSAGES, isErrorCode, type ErrorCode } from '@/lib/errors';
import type { GameView, QuestionDraft } from '@/lib/types';

export class ClientError extends Error {
  constructor(public code: ErrorCode, message?: string) {
    super(message ?? ERROR_MESSAGES[code]);
  }
}

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
  } catch {
    throw new ClientError('NETWORK_ERROR');
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* geen JSON */
  }
  if (!res.ok) {
    const code = (body as { code?: unknown })?.code;
    throw new ClientError(isErrorCode(code) ? code : res.status >= 500 ? 'SERVER_ERROR' : 'BAD_REQUEST');
  }
  return body as T;
}

const enc = encodeURIComponent;

export const api = {
  createGame(questions: QuestionDraft[]) {
    return request<{ roomCode: string; hostToken: string }>('/api/games', {
      method: 'POST',
      body: JSON.stringify({
        questions: questions.map((q) => ({ question: q.question, correctAnswer: q.correctAnswer })),
      }),
    });
  },
  join(roomCode: string, name: string) {
    return request<{ roomCode: string; playerId: string; playerToken: string; name: string }>(
      `/api/games/${enc(roomCode)}/join`,
      { method: 'POST', body: JSON.stringify({ name }) },
    );
  },
  state(roomCode: string, token: string) {
    return request<GameView>(`/api/games/${enc(roomCode)}/state`, { token });
  },
  submitAnswer(roomCode: string, token: string, answer: string) {
    return request<{ answer: string }>(`/api/games/${enc(roomCode)}/answer`, {
      method: 'POST',
      token,
      body: JSON.stringify({ answer }),
    });
  },
  vote(roomCode: string, token: string, optionId: string) {
    return request<{ optionId: string }>(`/api/games/${enc(roomCode)}/vote`, {
      method: 'POST',
      token,
      body: JSON.stringify({ optionId }),
    });
  },
  host(roomCode: string, token: string, action: HostAction, extra: Record<string, string> = {}) {
    return request<{ done: true }>(`/api/games/${enc(roomCode)}/host`, {
      method: 'POST',
      token,
      body: JSON.stringify({ action, ...extra }),
    });
  },
};

export type HostAction =
  | 'start'
  | 'openVoting'
  | 'reveal'
  | 'scoreboard'
  | 'nextQuestion'
  | 'finish'
  | 'restart'
  | 'close'
  | 'kick';
