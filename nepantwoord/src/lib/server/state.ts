import 'server-only';
import { db } from './supabase';
import { ApiError } from './http';
import type { Session } from './session';
import { CONNECTED_WINDOW_MS, MAX_PLAYERS, MIN_PLAYERS, POINTS_PER_FOOLED_PLAYER } from '@/lib/constants';
import { rankStandings } from '@/lib/standings';
import type { GameView, ProgressEntry, RevealData, RevealOption } from '@/lib/types';

interface PlayerRecord {
  id: string;
  name: string;
  score: number;
  last_seen_at: string;
}

function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) {
    console.error(result.error);
    throw new ApiError('SERVER_ERROR');
  }
  return result.data as T;
}

/**
 * Bouwt de weergave van het spel voor één deelnemer.
 *
 * BELANGRIJK: het juiste antwoord wordt alleen opgehaald en meegestuurd in de
 * fase REVEAL. In alle andere fases verlaat het de database niet. Dat geldt
 * ook voor de host, omdat het hostscherm vaak voor iedereen zichtbaar is.
 * Auteurs van nepantwoorden worden ook pas bij de onthulling meegestuurd.
 */
export async function buildView(session: Session): Promise<GameView> {
  const { game } = session;
  const client = db();
  const meId = session.role === 'player' ? session.player.id : null;

  // Hartslag: markeer de speler als verbonden (hoogstens eens per 5 seconden schrijven).
  if (session.role === 'player') {
    const threshold = new Date(Date.now() - 5000).toISOString();
    await client
      .from('players')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', session.player.id)
      .lt('last_seen_at', threshold);
  }

  const [players, countResult] = await Promise.all([
    client
      .from('players')
      .select('id, name, score, last_seen_at')
      .eq('game_id', game.id)
      .order('created_at', { ascending: true })
      .then((r) => unwrap<PlayerRecord[]>(r)),
    client.from('questions').select('id', { count: 'exact', head: true }).eq('game_id', game.id),
  ]);
  if (countResult.error) throw new ApiError('SERVER_ERROR');
  const questionCount = countResult.count ?? 0;

  const now = Date.now();
  const me = meId ? players.find((p) => p.id === meId) ?? null : null;

  const view: GameView = {
    role: session.role,
    roomCode: game.room_code,
    status: game.status,
    maxPlayers: MAX_PLAYERS,
    minPlayers: MIN_PLAYERS,
    questionCount,
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.id === meId || now - new Date(p.last_seen_at).getTime() < CONNECTED_WINDOW_MS,
    })),
    me: me ? { id: me.id, name: me.name, score: me.score } : null,
    question: null,
  };

  if (game.status === 'LOBBY' || game.status === 'CLOSED') return view;

  const standings = rankStandings(players);
  const isLastQuestion = game.current_question + 1 >= questionCount;

  if (game.status === 'FINISHED') {
    view.standings = standings;
    return view;
  }

  // Let op: correct_answer wordt hier bewust NIET geselecteerd.
  const question = unwrap<{ id: string; position: number; question: string }>(
    await client
      .from('questions')
      .select('id, position, question')
      .eq('game_id', game.id)
      .eq('position', game.current_question)
      .single(),
  );
  view.question = { number: question.position + 1, total: questionCount, text: question.question };
  view.isLastQuestion = isLastQuestion;

  const progress = (doneIds: Set<string>): ProgressEntry[] =>
    players.map((p) => ({ id: p.id, name: p.name, done: doneIds.has(p.id) }));

  switch (game.status) {
    case 'SUBMITTING_ANSWERS': {
      const answers = unwrap<{ player_id: string; answer: string }[]>(
        await client.from('fake_answers').select('player_id, answer').eq('question_id', question.id),
      );
      // Iedereen ziet de voortgang (zonder inhoud); alleen de speler zelf ziet zijn eigen tekst.
      view.answerProgress = progress(new Set(answers.map((a) => a.player_id)));
      if (meId) view.myAnswer = answers.find((a) => a.player_id === meId)?.answer ?? null;
      return view;
    }

    case 'VOTING': {
      const [options, myFake, votes] = await Promise.all([
        client
          .from('answer_options')
          .select('id, text, fake_answer_id')
          .eq('question_id', question.id)
          .order('position', { ascending: true })
          .then((r) => unwrap<{ id: string; text: string; fake_answer_id: string | null }[]>(r)),
        meId
          ? client
              .from('fake_answers')
              .select('id')
              .eq('question_id', question.id)
              .eq('player_id', meId)
              .maybeSingle()
              .then((r) => unwrap<{ id: string } | null>(r))
          : Promise.resolve(null),
        client
          .from('votes')
          .select('player_id, option_id')
          .eq('question_id', question.id)
          .then((r) => unwrap<{ player_id: string; option_id: string }[]>(r)),
      ]);
      // Alleen id + tekst (+ "eigen antwoord" voor de speler zelf). Geen auteur, geen "is juist".
      view.options = options.map((o) => ({
        id: o.id,
        text: o.text,
        ...(meId ? { isOwn: myFake !== null && o.fake_answer_id === myFake.id } : {}),
      }));
      view.voteProgress = progress(new Set(votes.map((v) => v.player_id)));
      if (meId) view.myVoteOptionId = votes.find((v) => v.player_id === meId)?.option_id ?? null;
      return view;
    }

    case 'REVEAL': {
      view.reveal = await buildReveal(question.id, players);
      view.standings = standings;
      return view;
    }

    case 'SCOREBOARD': {
      view.standings = standings;
      return view;
    }
  }
  return view;
}

async function buildReveal(questionId: string, players: PlayerRecord[]): Promise<RevealData> {
  const client = db();
  const [question, options, fakes, votes, scores] = await Promise.all([
    client
      .from('questions')
      .select('correct_answer')
      .eq('id', questionId)
      .single()
      .then((r) => unwrap<{ correct_answer: string }>(r)),
    client
      .from('answer_options')
      .select('id, text, is_correct, fake_answer_id')
      .eq('question_id', questionId)
      .order('position', { ascending: true })
      .then((r) => unwrap<{ id: string; text: string; is_correct: boolean; fake_answer_id: string | null }[]>(r)),
    client
      .from('fake_answers')
      .select('id, player_id')
      .eq('question_id', questionId)
      .then((r) => unwrap<{ id: string; player_id: string }[]>(r)),
    client
      .from('votes')
      .select('player_id, option_id, created_at')
      .eq('question_id', questionId)
      .order('created_at', { ascending: true })
      .then((r) => unwrap<{ player_id: string; option_id: string }[]>(r)),
    client
      .from('round_scores')
      .select('player_id, points')
      .eq('question_id', questionId)
      .then((r) => unwrap<{ player_id: string; points: number }[]>(r)),
  ]);

  const nameOf = new Map(players.map((p) => [p.id, p.name]));
  const authorOf = new Map(fakes.map((f) => [f.id, f.player_id]));

  const revealOptions: RevealOption[] = options.map((o) => {
    const authorId = o.fake_answer_id ? authorOf.get(o.fake_answer_id) ?? null : null;
    const voters = votes
      .filter((v) => v.option_id === o.id)
      .map((v) => ({ id: v.player_id, name: nameOf.get(v.player_id) ?? '?' }));
    return {
      id: o.id,
      text: o.text,
      isCorrect: o.is_correct,
      author: authorId ? { id: authorId, name: nameOf.get(authorId) ?? '?' } : null,
      voters,
      authorPoints: o.is_correct ? 0 : voters.filter((v) => v.id !== authorId).length * POINTS_PER_FOOLED_PLAYER,
    };
  });

  // Volgorde van onthullen: eerst de nepantwoorden (minst gekozen eerst), het juiste antwoord als laatste.
  revealOptions.sort((a, b) => {
    if (a.isCorrect !== b.isCorrect) return a.isCorrect ? 1 : -1;
    return a.voters.length - b.voters.length;
  });

  const pointsOf = new Map(scores.map((s) => [s.player_id, s.points]));
  const roundPoints = players
    .map((p) => ({ id: p.id, name: p.name, points: pointsOf.get(p.id) ?? 0 }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'nl'));

  return { correctAnswer: question.correct_answer, options: revealOptions, roundPoints };
}
