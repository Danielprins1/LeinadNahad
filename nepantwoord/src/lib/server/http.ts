import 'server-only';
import { NextResponse } from 'next/server';
import { ERROR_MESSAGES, isErrorCode, type ErrorCode } from '@/lib/errors';

const STATUS: Partial<Record<ErrorCode, number>> = {
  GAME_NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  SERVER_ERROR: 500,
  BAD_REQUEST: 400,
};

export class ApiError extends Error {
  constructor(public code: ErrorCode) {
    super(code);
  }
}

export function errorResponse(code: ErrorCode): NextResponse {
  return NextResponse.json(
    { error: ERROR_MESSAGES[code], code },
    { status: STATUS[code] ?? 409, headers: { 'Cache-Control': 'no-store' } },
  );
}

export function ok<T>(data: T): NextResponse {
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}

/** Vertaalt een fout uit een databasefunctie naar een bekende foutcode. */
export function codeFromDbError(error: { message?: string; code?: string } | null): ErrorCode {
  const msg = error?.message?.trim();
  if (isErrorCode(msg)) return msg;
  console.error('Onverwachte databasefout:', error);
  return 'SERVER_ERROR';
}

/** Wikkelt een route-handler zodat iedere fout een nette Nederlandse melding wordt. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<NextResponse>) {
  return async (...args: A): Promise<NextResponse> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ApiError) return errorResponse(err.code);
      console.error(err);
      return errorResponse('SERVER_ERROR');
    }
  };
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    /* val door */
  }
  throw new ApiError('BAD_REQUEST');
}
