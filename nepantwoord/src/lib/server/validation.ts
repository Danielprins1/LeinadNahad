import 'server-only';
import { ApiError } from './http';
import { cleanText, normalizeAnswer, normalizeName } from '@/lib/normalize';
import {
  MAX_ANSWER_LENGTH,
  MAX_NAME_LENGTH,
  MAX_QUESTION_LENGTH,
  MAX_QUESTIONS,
  MIN_QUESTIONS,
} from '@/lib/constants';

export function parseName(input: unknown): { name: string; key: string } {
  if (typeof input !== 'string') throw new ApiError('INVALID_NAME');
  const name = cleanText(input);
  if (name.length < 1 || name.length > MAX_NAME_LENGTH) throw new ApiError('INVALID_NAME');
  return { name, key: normalizeName(name) };
}

export function parseAnswer(input: unknown): { answer: string; normalized: string } {
  if (typeof input !== 'string') throw new ApiError('EMPTY_ANSWER');
  const answer = cleanText(input);
  if (answer.length > MAX_ANSWER_LENGTH) throw new ApiError('ANSWER_TOO_LONG');
  const normalized = normalizeAnswer(answer);
  if (!normalized) throw new ApiError('EMPTY_ANSWER');
  return { answer, normalized };
}

export function parseQuestions(input: unknown) {
  if (!Array.isArray(input) || input.length < MIN_QUESTIONS || input.length > MAX_QUESTIONS) {
    throw new ApiError('INVALID_QUESTIONS');
  }
  return input.map((raw) => {
    const q = raw as { question?: unknown; correctAnswer?: unknown };
    if (typeof q?.question !== 'string' || typeof q?.correctAnswer !== 'string') {
      throw new ApiError('INVALID_QUESTIONS');
    }
    const question = cleanText(q.question);
    const correct = cleanText(q.correctAnswer);
    const normalized = normalizeAnswer(correct);
    if (!question || question.length > MAX_QUESTION_LENGTH) throw new ApiError('INVALID_QUESTIONS');
    if (!normalized || correct.length > MAX_ANSWER_LENGTH) throw new ApiError('INVALID_QUESTIONS');
    return { question, correct_answer: correct, normalized_answer: normalized };
  });
}
