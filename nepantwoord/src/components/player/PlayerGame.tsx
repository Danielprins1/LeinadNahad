'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, Eyebrow, PlayerList, Stack, Standings, TextField, Waiting, points } from '@/components/ui';
import { FinalStandings, QuestionHeader, RevealView } from '@/components/game/shared';
import { GameFrame } from '@/components/game/Frame';
import { api, ClientError } from '@/lib/client/api';
import { clearSession, type StoredSession } from '@/lib/client/session';
import { useGame } from '@/lib/client/useGame';
import { MAX_ANSWER_LENGTH } from '@/lib/constants';
import type { GameView } from '@/lib/types';

export function PlayerGame({ code }: { code: string }) {
  const { session, state, offline, refresh } = useGame(code, 'player');

  const noSession = (
    <Card>
      <Stack>
        <h1 className="ui-subtitle">Je doet nog niet mee aan dit spel.</h1>
        <Link href={`/meedoen?code=${encodeURIComponent(code)}`} className="ui-button ui-button--primary ui-button--block">
          Meedoen
        </Link>
        <Link href="/" className="ui-button ui-button--ghost ui-button--block">
          Terug naar start
        </Link>
      </Stack>
    </Card>
  );

  return (
    <GameFrame state={state} offline={offline} noSession={noSession}>
      {state.kind === 'ready' && session && <PlayerPhase view={state.view} session={session} refresh={refresh} />}
    </GameFrame>
  );
}

function PlayerPhase({ view, session, refresh }: { view: GameView; session: StoredSession; refresh: () => Promise<void> }) {
  const router = useRouter();
  const meId = view.me?.id ?? null;

  switch (view.status) {
    case 'LOBBY':
      return (
        <Stack gap="lg">
          <Card>
            <Stack gap="sm">
              <p className="ui-subtitle ui-center">Je doet mee!</p>
              <p className="ui-title ui-center">{view.me?.name}</p>
              <p className="ui-muted ui-center">Wachten tot de host het spel start...</p>
            </Stack>
          </Card>
          <Stack gap="sm">
            <Eyebrow>
              {view.players.length} / {view.maxPlayers} spelers · room {view.roomCode}
            </Eyebrow>
            <PlayerList players={view.players} />
          </Stack>
        </Stack>
      );

    case 'SUBMITTING_ANSWERS':
      return (
        <Stack gap="lg">
          {view.question && <QuestionHeader question={view.question} />}
          {view.myAnswer ? (
            <Stack>
              <Alert kind="success">Antwoord opgeslagen!</Alert>
              <Card muted>
                <Stack gap="sm">
                  <Eyebrow>Jouw antwoord</Eyebrow>
                  <p className="ui-subtitle">{view.myAnswer}</p>
                </Stack>
              </Card>
              <Waiting
                title="Wachten op de andere spelers..."
                text={progressText(view.answerProgress, 'antwoorden binnen')}
              />
            </Stack>
          ) : (
            <AnswerForm key={view.question?.number} session={session} refresh={refresh} />
          )}
        </Stack>
      );

    case 'VOTING':
      return (
        <Stack gap="lg">
          {view.question && <QuestionHeader question={view.question} />}
          <VoteForm key={view.question?.number} view={view} session={session} refresh={refresh} />
        </Stack>
      );

    case 'REVEAL': {
      const mine = view.reveal?.roundPoints.find((p) => p.id === meId);
      return (
        <Stack gap="lg">
          {view.question && <QuestionHeader question={view.question} />}
          {mine && (
            <Card muted>
              <p className="ui-subtitle ui-center">Jij verdient deze ronde +{points(mine.points)}</p>
            </Card>
          )}
          {view.reveal && <RevealView reveal={view.reveal} meId={meId} />}
        </Stack>
      );
    }

    case 'SCOREBOARD':
      return (
        <Stack gap="lg">
          <h1 className="ui-title">Tussenstand</h1>
          <Standings standings={view.standings ?? []} meId={meId} />
          <p className="ui-muted ui-center">Wachten op de host...</p>
        </Stack>
      );

    case 'FINISHED':
      return (
        <Stack gap="lg">
          <h1 className="ui-title ui-center">Eindstand</h1>
          <FinalStandings standings={view.standings ?? []} meId={meId} />
          <p className="ui-muted ui-center">Bedankt voor het spelen!</p>
        </Stack>
      );

    case 'CLOSED':
      return (
        <Card>
          <Stack>
            <h1 className="ui-subtitle">Het spel is afgelopen.</h1>
            <p className="ui-muted">Bedankt voor het spelen!</p>
            <Button
              block
              onClick={() => {
                clearSession();
                router.push('/');
              }}
            >
              Terug naar start
            </Button>
          </Stack>
        </Card>
      );
  }
}

function progressText(entries: GameView['answerProgress'], label: string) {
  if (!entries) return undefined;
  return `${entries.filter((e) => e.done).length} / ${entries.length} ${label}`;
}

function AnswerForm({ session, refresh }: { session: StoredSession; refresh: () => Promise<void> }) {
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!answer.trim()) return setError('Vul een antwoord in.');
    setBusy(true);
    setError(null);
    try {
      await api.submitAnswer(session.roomCode, session.token, answer);
      await refresh();
    } catch (err) {
      const code = err instanceof ClientError ? err.code : null;
      if (code === 'ALREADY_SUBMITTED' || code === 'PHASE_CLOSED') {
        await refresh();
      }
      setError(err instanceof ClientError ? err.message : 'Er ging iets mis. Probeer het opnieuw.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack>
        <p>Verzin een geloofwaardig antwoord waarvan je denkt dat andere spelers erin zullen trappen.</p>
        <TextField
          label="Jouw antwoord"
          value={answer}
          onChange={(e) => {
            setAnswer(e.target.value);
            if (error) setError(null);
          }}
          maxLength={MAX_ANSWER_LENGTH}
          autoComplete="off"
          autoCorrect="off"
          enterKeyHint="send"
          error={error}
        />
        <Button type="submit" block loading={busy}>
          Antwoord insturen
        </Button>
      </Stack>
    </form>
  );
}

function VoteForm({ view, session, refresh }: { view: GameView; session: StoredSession; refresh: () => Promise<void> }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const voted = view.myVoteOptionId ?? null;

  async function submit() {
    if (!selected) return setError('Kies eerst een antwoord.');
    setBusy(true);
    setError(null);
    try {
      await api.vote(session.roomCode, session.token, selected);
    } catch (err) {
      setError(err instanceof ClientError ? err.message : 'Er ging iets mis. Probeer het opnieuw.');
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  return (
    <Stack>
      <h2 className="ui-subtitle">Welk antwoord is echt?</h2>
      {voted && <Alert kind="success">Stem opgeslagen! Wachten op de rest...</Alert>}
      <div className="ui-stack ui-stack--sm" role="radiogroup" aria-label="Antwoorden">
        {view.options?.map((o) => {
          const isSelected = (voted ?? selected) === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={!!voted || o.isOwn || busy}
              onClick={() => {
                setSelected(o.id);
                setError(null);
              }}
              className={`ui-option${o.isOwn ? ' ui-option--own' : ''}${isSelected ? ' ui-option--selected' : ''}`}
            >
              <span>{o.text}</span>
              {o.isOwn && <span className="ui-option__note">Jouw antwoord</span>}
              {voted === o.id && <span className="ui-option__note">Jouw stem</span>}
            </button>
          );
        })}
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {!voted && (
        <Button block onClick={submit} disabled={!selected} loading={busy}>
          Stem insturen
        </Button>
      )}
      {!voted && <p className="ui-muted ui-small ui-center">Je stem is definitief en kan daarna niet meer worden gewijzigd.</p>}
      {voted && (
        <p className="ui-muted ui-small ui-center">{progressText(view.voteProgress, 'spelers hebben gestemd')}</p>
      )}
    </Stack>
  );
}
