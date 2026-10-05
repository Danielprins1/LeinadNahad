'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Row, Screen, Stack, TextArea, TextField } from '@/components/ui';
import { api, ClientError } from '@/lib/client/api';
import { saveSession } from '@/lib/client/session';
import { MAX_ANSWER_LENGTH, MAX_QUESTION_LENGTH, MAX_QUESTIONS, MIN_QUESTIONS } from '@/lib/constants';
import { normalizeAnswer } from '@/lib/normalize';
import type { QuestionDraft } from '@/lib/types';

const DRAFT_KEY = 'nepantwoord.vragen-concept';

function emptyQuestion(): QuestionDraft {
  return { key: Math.random().toString(36).slice(2), question: '', correctAnswer: '' };
}

function loadDrafts(): QuestionDraft[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? 'null');
    if (Array.isArray(parsed) && parsed.length >= 1) return parsed.slice(0, MAX_QUESTIONS);
  } catch {
    /* negeren */
  }
  return [emptyQuestion()];
}

function validate(questions: QuestionDraft[]): string | null {
  if (questions.length < MIN_QUESTIONS) return 'Voeg minimaal 1 vraag toe.';
  if (questions.length > MAX_QUESTIONS) return `Je kunt maximaal ${MAX_QUESTIONS} vragen invoeren.`;
  for (const [i, q] of questions.entries()) {
    if (!q.question.trim()) return `Vul bij vraag ${i + 1} de vraag in.`;
    if (!normalizeAnswer(q.correctAnswer)) return `Vul bij vraag ${i + 1} het juiste antwoord in.`;
    if (q.question.trim().length > MAX_QUESTION_LENGTH) return `Vraag ${i + 1} is te lang.`;
    if (q.correctAnswer.trim().length > MAX_ANSWER_LENGTH) return `Het antwoord bij vraag ${i + 1} is te lang.`;
  }
  return null;
}

export default function NewGamePage() {
  const router = useRouter();
  const [questions, setQuestions] = useState<QuestionDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setQuestions(loadDrafts()), []);

  // Concept bewaren, zodat verversen niets kwijtraakt.
  useEffect(() => {
    if (!questions) return;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(questions));
    } catch {
      /* negeren */
    }
  }, [questions]);

  if (!questions) return null;

  const update = (index: number, patch: Partial<QuestionDraft>) =>
    setQuestions(questions.map((q, i) => (i === index ? { ...q, ...patch } : q)));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= questions.length) return;
    const next = [...questions];
    [next[index], next[target]] = [next[target], next[index]];
    setQuestions(next);
  };

  const remove = (index: number) => setQuestions(questions.filter((_, i) => i !== index));
  const add = () => questions.length < MAX_QUESTIONS && setQuestions([...questions, emptyQuestion()]);

  async function create() {
    const problem = validate(questions!);
    if (problem) return setError(problem);
    setError(null);
    setBusy(true);
    try {
      const res = await api.createGame(questions!);
      saveSession({ role: 'host', roomCode: res.roomCode, token: res.hostToken });
      router.push(`/host/${res.roomCode}`);
    } catch (err) {
      setError(err instanceof ClientError ? err.message : 'Er ging iets mis. Probeer het opnieuw.');
      setBusy(false);
    }
  }

  return (
    <Screen wide>
      <Stack gap="lg">
        <Stack gap="sm">
          <h1 className="ui-title">Spel aanmaken</h1>
          <p className="ui-muted">
            Voer 1 tot {MAX_QUESTIONS} vragen in, elk met het juiste antwoord. Spelers zien het juiste antwoord pas bij de
            onthulling.
          </p>
        </Stack>

        {questions.map((q, i) => (
          <Card key={q.key}>
            <Stack>
              <Row align="between">
                <h2 className="ui-subtitle">Vraag {i + 1}</h2>
                <Row>
                  <Button variant="ghost" size="small" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Vraag ${i + 1} omhoog`}>
                    ↑ Omhoog
                  </Button>
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => move(i, 1)}
                    disabled={i === questions.length - 1}
                    aria-label={`Vraag ${i + 1} omlaag`}
                  >
                    ↓ Omlaag
                  </Button>
                  <Button variant="ghost" size="small" onClick={() => remove(i)} disabled={questions.length <= 1}>
                    Verwijderen
                  </Button>
                </Row>
              </Row>
              <TextArea
                label="Vraag"
                value={q.question}
                maxLength={MAX_QUESTION_LENGTH}
                onChange={(e) => update(i, { question: e.target.value })}
                placeholder="Bijvoorbeeld: Welk land heeft als enige een vlag die niet rechthoekig is?"
              />
              <TextField
                label="Juiste antwoord"
                value={q.correctAnswer}
                maxLength={MAX_ANSWER_LENGTH}
                onChange={(e) => update(i, { correctAnswer: e.target.value })}
                placeholder="Bijvoorbeeld: Nepal"
                autoComplete="off"
              />
            </Stack>
          </Card>
        ))}

        {questions.length < MAX_QUESTIONS && (
          <Button variant="secondary" block onClick={add}>
            + Vraag toevoegen ({questions.length}/{MAX_QUESTIONS})
          </Button>
        )}

        {error && <Alert kind="error">{error}</Alert>}

        <Button block onClick={create} loading={busy}>
          Spel aanmaken
        </Button>
        <Link href="/" className="ui-button ui-button--ghost ui-button--block">
          Terug
        </Link>
      </Stack>
    </Screen>
  );
}
