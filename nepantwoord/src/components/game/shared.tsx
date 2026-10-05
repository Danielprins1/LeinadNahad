/** Spelonderdelen die zowel de host als de spelers tonen. */
import { Card, Eyebrow, Stack, Standings, points } from '@/components/ui';
import { POINTS_CORRECT_GUESS } from '@/lib/constants';
import type { QuestionInfo, RevealData, Standing } from '@/lib/types';

export function QuestionHeader({ question, large }: { question: QuestionInfo; large?: boolean }) {
  return (
    <Stack gap="sm">
      <Eyebrow>
        Vraag {question.number} van {question.total}
      </Eyebrow>
      <h1 className={large ? 'ui-title' : 'ui-subtitle'}>{question.text}</h1>
    </Stack>
  );
}

function names(list: { name: string }[]) {
  return list.map((v) => v.name).join(', ');
}

export function RevealView({ reveal, meId }: { reveal: RevealData; meId?: string | null }) {
  return (
    <Stack>
      {reveal.options.map((o) =>
        o.isCorrect ? (
          <div key={o.id} className="ui-reveal ui-reveal--correct">
            <p className="ui-reveal__answer">{o.text}</p>
            <p className="ui-reveal__badge">✓ Juiste antwoord</p>
            {o.voters.length > 0 ? (
              <>
                <p>
                  <strong>Goed geraden door:</strong> {names(o.voters)}
                </p>
                <p className="ui-reveal__points">+{points(POINTS_CORRECT_GUESS)} per speler</p>
              </>
            ) : (
              <p>Niemand had het goed.</p>
            )}
          </div>
        ) : (
          <div key={o.id} className="ui-reveal">
            <p className="ui-reveal__answer">{o.text}</p>
            <p className="ui-muted">
              Bedacht door <strong>{o.author?.id === meId ? `${o.author?.name} (jij)` : o.author?.name}</strong>
            </p>
            {o.voters.length > 0 ? (
              <>
                <p>
                  <strong>
                    {o.voters.length} {o.voters.length === 1 ? 'speler trapte' : 'spelers trapten'} erin:
                  </strong>{' '}
                  {names(o.voters)}
                </p>
                <p className="ui-reveal__points">
                  {o.author?.name}: +{points(o.authorPoints)}
                </p>
              </>
            ) : (
              <p className="ui-muted">Niemand trapte erin.</p>
            )}
          </div>
        ),
      )}
    </Stack>
  );
}

export function RoundPoints({ reveal, meId }: { reveal: RevealData; meId?: string | null }) {
  return (
    <Card>
      <Stack>
        <h2 className="ui-subtitle">Punten deze ronde</h2>
        <ol className="ui-list">
          {reveal.roundPoints.map((p) => (
            <li
              key={p.id}
              className={`ui-standings__item${p.id === meId ? ' ui-standings__item--me' : ''}`}
            >
              <span />
              <span className="ui-standings__name">{p.name}</span>
              <span className="ui-standings__score">+{points(p.points)}</span>
            </li>
          ))}
        </ol>
      </Stack>
    </Card>
  );
}

export function FinalStandings({ standings, meId }: { standings: Standing[]; meId?: string | null }) {
  const winners = standings.filter((s) => s.rank === 1);
  const runnersUp = standings.filter((s) => s.rank === 2 || s.rank === 3);
  return (
    <Stack gap="lg">
      <Card>
        <div className="ui-winner">
          <Eyebrow>{winners.length > 1 ? 'Winnaars' : 'Winnaar'}</Eyebrow>
          {winners.map((w) => (
            <p key={w.id} className="ui-winner__name">
              {w.name}
            </p>
          ))}
          {winners[0] && <p className="ui-subtitle">{points(winners[0].score).toUpperCase()}</p>}
        </div>
      </Card>
      {runnersUp.length > 0 && <Standings standings={runnersUp} meId={meId} />}
      {standings.length > winners.length + runnersUp.length && (
        <Stack gap="sm">
          <h2 className="ui-subtitle">Volledige uitslag</h2>
          <Standings standings={standings} meId={meId} />
        </Stack>
      )}
    </Stack>
  );
}
