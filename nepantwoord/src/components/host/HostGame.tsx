'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Counter, Eyebrow, PlayerList, ProgressList, RoomCode, Row, Stack, Standings } from '@/components/ui';
import { FinalStandings, QuestionHeader, RevealView, RoundPoints } from '@/components/game/shared';
import { GameFrame } from '@/components/game/Frame';
import { api, ClientError, type HostAction } from '@/lib/client/api';
import { clearSession } from '@/lib/client/session';
import { useGame } from '@/lib/client/useGame';
import type { GameView } from '@/lib/types';

export function HostGame({ code }: { code: string }) {
  const router = useRouter();
  const { session, state, offline, refresh } = useGame(code, 'host');
  const [busy, setBusy] = useState<HostAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: HostAction, extra?: Record<string, string>) {
    if (!session || busy) return;
    setBusy(action);
    setError(null);
    try {
      await api.host(session.roomCode, session.token, action, extra);
    } catch (err) {
      // "Al uitgevoerd" (bijv. dubbelklik of tweede tabblad) hoeft geen melding.
      if (!(err instanceof ClientError && err.code === 'INVALID_STATE')) {
        setError(err instanceof ClientError ? err.message : 'Er ging iets mis.');
      }
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  async function backToStart() {
    if (session && state.kind === 'ready' && state.view.status !== 'CLOSED') {
      try {
        await api.host(session.roomCode, session.token, 'close');
      } catch {
        /* het spel sluiten is netjes, maar niet noodzakelijk */
      }
    }
    clearSession();
    router.push('/');
  }

  function endGame() {
    if (window.confirm('Weet je zeker dat je het spel wilt beëindigen? Dit kan niet ongedaan worden gemaakt.')) {
      void run('close');
    }
  }

  const noSession = (
    <Card>
      <Stack>
        <h1 className="ui-subtitle">Je bent niet de host van dit spel.</h1>
        <p className="ui-muted">Alleen het apparaat waarmee het spel is aangemaakt, kan het spel besturen.</p>
        <Link href={`/meedoen?code=${encodeURIComponent(code)}`} className="ui-button ui-button--primary ui-button--block">
          Meedoen als speler
        </Link>
        <Link href="/" className="ui-button ui-button--ghost ui-button--block">
          Terug naar start
        </Link>
      </Stack>
    </Card>
  );

  return (
    <GameFrame wide state={state} offline={offline} noSession={noSession}>
      {state.kind === 'ready' && (
        <Stack gap="lg">
          {state.view.status !== 'LOBBY' && state.view.status !== 'CLOSED' && (
            <Row align="between">
              <span className="ui-tag">Roomcode {state.view.roomCode}</span>
              {state.view.status !== 'FINISHED' && (
                <Button variant="ghost" size="small" onClick={endGame}>
                  Spel beëindigen
                </Button>
              )}
            </Row>
          )}
          {error && <Alert kind="error">{error}</Alert>}
          <HostPhase view={state.view} busy={busy} run={run} backToStart={backToStart} />
        </Stack>
      )}
    </GameFrame>
  );
}

function HostPhase({
  view,
  busy,
  run,
  backToStart,
}: {
  view: GameView;
  busy: HostAction | null;
  run: (action: HostAction, extra?: Record<string, string>) => void;
  backToStart: () => void;
}) {
  const total = view.players.length;

  switch (view.status) {
    case 'LOBBY':
      return <Lobby view={view} busy={busy} run={run} />;

    case 'SUBMITTING_ANSWERS': {
      const done = view.answerProgress?.filter((p) => p.done).length ?? 0;
      return (
        <Stack gap="lg">
          {view.question && <QuestionHeader question={view.question} large />}
          <Card>
            <Stack>
              <Counter label="Antwoorden ingeleverd" value={done} total={total} />
              <ProgressList entries={view.answerProgress ?? []} />
            </Stack>
          </Card>
          {done < total && (
            <p className="ui-muted ui-small ui-center">
              Je kunt altijd doorgaan. Wie nog geen antwoord heeft, kan wel stemmen.
            </p>
          )}
          <Button block onClick={() => run('openVoting')} loading={busy === 'openVoting'}>
            Door naar stemmen
          </Button>
        </Stack>
      );
    }

    case 'VOTING': {
      const done = view.voteProgress?.filter((p) => p.done).length ?? 0;
      return (
        <Stack gap="lg">
          {view.question && <QuestionHeader question={view.question} large />}
          <Card>
            <Stack gap="sm">
              <Eyebrow>Welk antwoord is echt?</Eyebrow>
              <ul className="ui-list">
                {view.options?.map((o) => (
                  <li key={o.id} className="ui-list__item">
                    {o.text}
                  </li>
                ))}
              </ul>
            </Stack>
          </Card>
          <Card>
            <Stack>
              <Counter label="Stemmen" value={done} total={total} />
              <ProgressList entries={view.voteProgress ?? []} />
            </Stack>
          </Card>
          <Button block onClick={() => run('reveal')} loading={busy === 'reveal'}>
            Onthul antwoorden
          </Button>
        </Stack>
      );
    }

    case 'REVEAL':
      return (
        <Stack gap="lg">
          {view.question && <QuestionHeader question={view.question} large />}
          {view.reveal && (
            <div className="ui-grid ui-grid--2">
              <RevealView reveal={view.reveal} />
              <div>
                <RoundPoints reveal={view.reveal} />
              </div>
            </div>
          )}
          <Button block onClick={() => run('scoreboard')} loading={busy === 'scoreboard'}>
            Toon tussenstand
          </Button>
        </Stack>
      );

    case 'SCOREBOARD':
      return (
        <Stack gap="lg">
          <Stack gap="sm">
            <Eyebrow>
              Na vraag {view.question?.number} van {view.question?.total}
            </Eyebrow>
            <h1 className="ui-title">Tussenstand</h1>
          </Stack>
          <Standings standings={view.standings ?? []} />
          {view.isLastQuestion ? (
            <Button block onClick={() => run('finish')} loading={busy === 'finish'}>
              Toon eindstand
            </Button>
          ) : (
            <Button block onClick={() => run('nextQuestion')} loading={busy === 'nextQuestion'}>
              Volgende vraag
            </Button>
          )}
        </Stack>
      );

    case 'FINISHED':
      return (
        <Stack gap="lg">
          <h1 className="ui-title ui-center">Eindstand</h1>
          <FinalStandings standings={view.standings ?? []} />
          <div className="ui-grid ui-grid--2">
            <Button onClick={() => run('restart')} loading={busy === 'restart'}>
              Opnieuw spelen
            </Button>
            <Button variant="secondary" onClick={backToStart}>
              Terug naar start
            </Button>
          </div>
        </Stack>
      );

    case 'CLOSED':
      return (
        <Card>
          <Stack>
            <h1 className="ui-subtitle">Het spel is beëindigd.</h1>
            <Button block onClick={backToStart}>
              Terug naar start
            </Button>
          </Stack>
        </Card>
      );
  }
}

function Lobby({ view, busy, run }: { view: GameView; busy: HostAction | null; run: (a: HostAction, e?: Record<string, string>) => void }) {
  const [joinUrl, setJoinUrl] = useState('');
  useEffect(() => setJoinUrl(`${window.location.origin}/meedoen?code=${view.roomCode}`), [view.roomCode]);
  const count = view.players.length;
  const canStart = count >= view.minPlayers;

  return (
    <Stack gap="lg">
      <Card>
        <Stack>
          <RoomCode code={view.roomCode} />
          <p className="ui-center ui-muted ui-small">
            Ga naar <strong>{joinUrl ? new URL(joinUrl).host : ''}</strong>, kies Meedoen en vul de roomcode in.
          </p>
        </Stack>
      </Card>

      <Card>
        <Stack>
          <Row align="between">
            <h2 className="ui-subtitle">Spelers</h2>
            <span className="ui-subtitle">
              {count} / {view.maxPlayers} spelers
            </span>
          </Row>
          <PlayerList
            players={view.players}
            columns
            onRemove={(p) => {
              if (window.confirm(`${p.name} uit de lobby verwijderen?`)) run('kick', { playerId: p.id });
            }}
          />
        </Stack>
      </Card>

      {!canStart && (
        <p className="ui-muted ui-center">Er zijn minimaal {view.minPlayers} spelers nodig om te starten.</p>
      )}
      <Button block onClick={() => run('start')} disabled={!canStart} loading={busy === 'start'}>
        Start spel
      </Button>
      <p className="ui-muted ui-small ui-center">
        {view.questionCount} {view.questionCount === 1 ? 'vraag' : 'vragen'} klaargezet. Na de start kan niemand meer
        meedoen.
      </p>
    </Stack>
  );
}
