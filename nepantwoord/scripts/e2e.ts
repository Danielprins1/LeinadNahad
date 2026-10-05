/**
 * End-to-end test tegen een draaiende app + Supabase (lokaal of online).
 *
 *   npm run build && npm start        (in een ander venster)
 *   npm run test:e2e                  (BASE_URL=http://localhost:3000 standaard)
 *
 * Speelt een volledig spel met 30 spelers via de echte API, luistert mee via
 * Supabase Realtime en controleert o.a. dubbele antwoorden (ook gelijktijdig),
 * dubbel stemmen, stemmen op jezelf, hostrechten, puntentelling en dat het
 * juiste antwoord vóór de onthulling nergens in een response staat.
 */
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

// .env.local inlezen voor de realtime-test
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* geen .env.local */
}

type Json = Record<string, any>;

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) as Json };
}

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const SECRETS = ['Nepal', 'Canberra'];

function assertNoSecret(text: string, secret: string, where: string) {
  assert.ok(!text.toLowerCase().includes(secret.toLowerCase()), `Juiste antwoord "${secret}" gelekt in ${where}`);
}

async function main() {
  console.log(`E2E tegen ${BASE}\n`);

  // ---------- Spel aanmaken ----------
  const bad = await call('POST', '/api/games', { questions: [] });
  check('spel zonder vragen wordt geweigerd', () => assert.equal(bad.json.code, 'INVALID_QUESTIONS'));
  const six = await call('POST', '/api/games', {
    questions: Array.from({ length: 6 }, (_, i) => ({ question: `V${i}`, correctAnswer: `A${i}` })),
  });
  check('meer dan 5 vragen wordt geweigerd', () => assert.equal(six.json.code, 'INVALID_QUESTIONS'));

  const created = await call('POST', '/api/games', {
    questions: [
      { question: 'Welk land heeft als enige een niet-rechthoekige vlag?', correctAnswer: 'Nepal' },
      { question: 'Wat is de hoofdstad van Australië?', correctAnswer: 'Canberra' },
    ],
  });
  assert.equal(created.status, 200, created.text);
  const { roomCode, hostToken } = created.json as { roomCode: string; hostToken: string };
  check('roomcode van 5 tekens', () => assert.match(roomCode, /^[A-Z0-9]{5}$/));
  assertNoSecret(created.text, 'Nepal', 'create-response');

  // ---------- Realtime meeluisteren ----------
  let refreshEvents = 0;
  const rt = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const realtimePayloads: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Realtime subscribe timeout')), 10000);
    rt.channel(`room:${roomCode}`)
      .on('broadcast', { event: 'refresh' }, (msg) => {
        refreshEvents++;
        realtimePayloads.push(JSON.stringify(msg));
      })
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') {
          clearTimeout(t);
          resolve();
        }
      });
  });
  // de anon-key kan geen tabellen lezen
  const direct = await rt.from('questions').select('*');
  check('browser-key kan de tabel met vragen niet lezen', () => assert.ok(direct.error || (direct.data ?? []).length === 0));

  // ---------- Meedoen ----------
  const wrong = await call('POST', '/api/games/QQQQQ/join', { name: 'Iemand' });
  check('verkeerde roomcode → nette melding', () => {
    assert.equal(wrong.status, 404);
    assert.equal(wrong.json.code, 'GAME_NOT_FOUND');
  });
  const empty = await call('POST', `/api/games/${roomCode}/join`, { name: '   ' });
  check('lege naam geweigerd', () => assert.equal(empty.json.code, 'INVALID_NAME'));

  const players: { id: string; token: string; name: string }[] = [];
  const joins = await Promise.all(
    Array.from({ length: 29 }, (_, i) => call('POST', `/api/games/${roomCode.toLowerCase()}/join`, { name: `Speler ${i + 1}` })),
  );
  for (const j of joins) {
    assert.equal(j.status, 200, j.text);
    players.push({ id: j.json.playerId, token: j.json.playerToken, name: j.json.name });
  }
  const dup = await call('POST', `/api/games/${roomCode}/join`, { name: '  speler   1 ' });
  check('dubbele naam (andere hoofdletters/spaties) geweigerd', () => assert.equal(dup.json.code, 'NAME_TAKEN'));

  // De laatste plek: 3 tegelijk, slechts één mag erin.
  const lastSpot = await Promise.all(['Laatste A', 'Laatste B', 'Laatste C'].map((name) => call('POST', `/api/games/${roomCode}/join`, { name })));
  const okLast = lastSpot.filter((r) => r.status === 200);
  check('30e plek: bij gelijktijdig aanmelden komt er maar één bij', () => {
    assert.equal(okLast.length, 1);
    assert.ok(lastSpot.filter((r) => r.status !== 200).every((r) => r.json.code === 'GAME_FULL'));
  });
  players.push({ id: okLast[0].json.playerId, token: okLast[0].json.playerToken, name: okLast[0].json.name });

  let host = await call('GET', `/api/games/${roomCode}/state`, undefined, hostToken);
  check('host ziet 30 / 30 spelers', () => assert.equal(host.json.players.length, 30));
  check('realtime-meldingen ontvangen bij meedoen', () => assert.ok(refreshEvents > 0));

  // ---------- Rechten ----------
  const p = players;
  const hack = await call('POST', `/api/games/${roomCode}/host`, { action: 'start' }, p[0].token);
  check('speler kan geen hostactie uitvoeren', () => assert.equal(hack.status, 403));
  const noToken = await call('POST', `/api/games/${roomCode}/host`, { action: 'start' });
  check('zonder token geen hostactie', () => assert.equal(noToken.status, 401));
  const fakeToken = await call('POST', `/api/games/${roomCode}/host`, { action: 'start' }, 'nep');
  check('verzonnen token geweigerd', () => assert.equal(fakeToken.status, 401));

  // kick in de lobby
  const extra = await call('POST', `/api/games/${roomCode}/host`, { action: 'kick', playerId: p[29].id }, hostToken);
  assert.equal(extra.status, 200, extra.text);
  const kicked = await call('GET', `/api/games/${roomCode}/state`, undefined, p[29].token);
  check('verwijderde speler heeft geen toegang meer', () => assert.equal(kicked.status, 401));
  const rejoin = await call('POST', `/api/games/${roomCode}/join`, { name: 'Laatkomer' });
  players[29] = { id: rejoin.json.playerId, token: rejoin.json.playerToken, name: rejoin.json.name };

  // ---------- Start ----------
  const start = await call('POST', `/api/games/${roomCode}/host`, { action: 'start' }, hostToken);
  assert.equal(start.status, 200, start.text);
  const late = await call('POST', `/api/games/${roomCode}/join`, { name: 'Te laat' });
  check('meedoen na start geweigerd', () => assert.equal(late.json.code, 'GAME_STARTED'));
  const startAgain = await call('POST', `/api/games/${roomCode}/host`, { action: 'start' }, hostToken);
  check('dubbel starten → "al uitgevoerd"', () => assert.equal(startAgain.json.code, 'INVALID_STATE'));

  const answer = (i: number, text: string) => call('POST', `/api/games/${roomCode}/answer`, { answer: text }, p[i].token);
  const vote = (i: number, optionId: string) => call('POST', `/api/games/${roomCode}/vote`, { optionId }, p[i].token);
  const state = (i: number) => call('GET', `/api/games/${roomCode}/state`, undefined, p[i].token);
  const hostAction = (action: string) => call('POST', `/api/games/${roomCode}/host`, { action }, hostToken);

  // ---------- Vraag 1: nepantwoorden ----------
  const s0 = await state(0);
  check('speler ziet vraag 1 van 2', () => {
    assert.equal(s0.json.status, 'SUBMITTING_ANSWERS');
    assert.equal(s0.json.question.number, 1);
    assert.equal(s0.json.question.total, 2);
  });
  assertNoSecret(s0.text, 'Nepal', 'spelerstatus (invoerfase)');

  const voteEarly = await vote(0, '00000000-0000-0000-0000-000000000000');
  check('stemmen vóór de stemfase geweigerd', () => assert.equal(voteEarly.json.code, 'PHASE_CLOSED'));

  for (const variant of ['Nepal', '  NEPAL ', 'nepal!', 'Népal']) {
    const r = await answer(0, variant);
    check(`juiste antwoord "${variant}" geweigerd met neutrale melding`, () => {
      assert.equal(r.json.code, 'CORRECT_ANSWER');
      assert.equal(r.json.error, 'Dat antwoord kun je niet gebruiken. Verzin een ander antwoord.');
    });
  }
  const r1 = await answer(1, '  Bhutan ');
  assert.equal(r1.status, 200, r1.text);
  const r2 = await answer(2, 'BHUTAN.');
  check('bestaand antwoord (genormaliseerd) geweigerd', () => {
    assert.equal(r2.json.code, 'DUPLICATE_ANSWER');
    assert.equal(r2.json.error, 'Dit antwoord is al gebruikt. Verzin een ander antwoord.');
    assert.ok(!r2.text.includes(p[1].name), 'naam van de bedenker mag niet in de melding');
  });
  const r1b = await answer(1, 'Iets anders');
  check('tweede nepantwoord van dezelfde speler geweigerd', () => assert.equal(r1b.json.code, 'ALREADY_SUBMITTED'));

  // Race: 10 spelers sturen tegelijk varianten van hetzelfde antwoord.
  const variants = ['New York', 'new york', ' NEW YORK ', 'New   York', 'new-york', 'NEW YORK!', 'New York.', 'new York', 'NeW yOrK', 'new  york '];
  const race = await Promise.all(variants.map((v, k) => answer(3 + k, v)));
  check('gelijktijdig hetzelfde antwoord: precies één wordt opgeslagen', () => {
    assert.equal(race.filter((r) => r.status === 200).length, 1);
    assert.equal(race.filter((r) => r.json.code === 'DUPLICATE_ANSWER').length, 9);
  });
  const raceWinner = 3 + race.findIndex((r) => r.status === 200);

  // Race: dezelfde speler stuurt twee antwoorden tegelijk.
  const doubleSubmit = await Promise.all([answer(13, 'Tibet'), answer(13, 'Mongolië')]);
  check('twee antwoorden tegelijk van één speler: één opgeslagen', () => {
    assert.equal(doubleSubmit.filter((r) => r.status === 200).length, 1);
    assert.equal(doubleSubmit.filter((r) => r.json.code === 'ALREADY_SUBMITTED').length, 1);
  });

  // Spelers 14..25 sturen een uniek antwoord; 0, 2, 4-12 (verliezers race) en 26-29 niet.
  await Promise.all(Array.from({ length: 12 }, (_, k) => answer(14 + k, `Land ${k + 1}`)));

  host = await call('GET', `/api/games/${roomCode}/state`, undefined, hostToken);
  check('host ziet alleen voortgang, geen inhoud', () => {
    const done = host.json.answerProgress.filter((x: Json) => x.done).length;
    assert.equal(done, 1 + 1 + 1 + 12);
    assert.ok(!host.text.includes('Bhutan'), 'host mag de nepantwoorden nog niet zien');
  });
  assertNoSecret(host.text, 'Nepal', 'hoststatus (invoerfase)');

  // ---------- Stemmen ----------
  const toVoting = await Promise.all([hostAction('openVoting'), hostAction('openVoting')]);
  check('dubbelklik "Door naar stemmen" wordt één keer uitgevoerd', () =>
    assert.equal(toVoting.filter((r) => r.status === 200).length, 1),
  );
  const lateAnswer = await answer(0, 'Laos');
  check('nepantwoord na de invoerfase geweigerd', () => assert.equal(lateAnswer.json.code, 'PHASE_CLOSED'));

  const views = await Promise.all(p.map((_, i) => state(i)));
  // In de stemfase staat het juiste antwoord als gewone optie tussen de rest (zonder markering).
  check('stemfase: "Nepal" komt precies één keer voor, als gewone optie', () => {
    for (const v of views) assert.equal(v.text.split('Nepal').length - 1, 1);
  });
  for (const t of realtimePayloads) assertNoSecret(t, 'Nepal', 'realtime-bericht');

  const options = views[0].json.options as { id: string; text: string; isOwn: boolean }[];
  check('16 opties: 15 nepantwoorden + het juiste antwoord', () => assert.equal(options.length, 16));
  check('alle spelers krijgen dezelfde opties in dezelfde volgorde', () => {
    const ids = options.map((o) => o.id).join();
    for (const v of views) assert.equal(v.json.options.map((o: Json) => o.id).join(), ids);
  });
  check('opties bevatten geen auteur of "juist"-markering', () => {
    for (const o of views[0].json.options) assert.deepEqual(Object.keys(o).sort(), ['id', 'isOwn', 'text']);
  });
  check('eigen antwoord gemarkeerd als eigen antwoord', () => {
    const own = views[1].json.options.filter((o: Json) => o.isOwn);
    assert.equal(own.length, 1);
    assert.equal(own[0].text, 'Bhutan');
    assert.equal(views[0].json.options.filter((o: Json) => o.isOwn).length, 0);
  });

  const optByText = (t: string) => options.find((o) => o.text === t)!.id;
  const bhutan = optByText('Bhutan');
  const nyText = variants[raceWinner - 3].trim().replace(/\s+/g, ' ');
  const ny = optByText(nyText);

  // Het juiste antwoord: de enige optie die geen nepantwoord van een speler is.
  const fakeTexts = new Set(['Bhutan', nyText, ...Array.from({ length: 12 }, (_, k) => `Land ${k + 1}`)]);
  fakeTexts.add(doubleSubmit[0].status === 200 ? 'Tibet' : 'Mongolië');
  const correct = options.find((o) => !fakeTexts.has(o.text))!.id;

  const own = await vote(1, bhutan);
  check('stemmen op eigen antwoord geweigerd', () => assert.equal(own.json.code, 'OWN_ANSWER'));
  const bogus = await vote(1, '11111111-1111-1111-1111-111111111111');
  check('stemmen op niet-bestaande optie geweigerd', () => assert.equal(bogus.json.code, 'INVALID_OPTION'));

  // Speler 0 (geen nepantwoord) stemt juist; 2 tegelijk → één stem.
  const dv = await Promise.all([vote(0, correct), vote(0, bhutan)]);
  check('twee stemmen tegelijk: één telt', () => {
    assert.equal(dv.filter((r) => r.status === 200).length, 1);
    assert.equal(dv.filter((r) => r.json.code === 'ALREADY_VOTED').length, 1);
  });
  const p0Correct = dv[0].status === 200;
  const again = await vote(0, ny);
  check('stem niet te wijzigen', () => assert.equal(again.json.code, 'ALREADY_VOTED'));

  // Stemmen: 2,4,5,6 op Bhutan; 1,7,8 juist; 9,10 op NY (tenzij eigen); 14..25 juist; 26-29 stemmen niet.
  const plan: [number, string][] = [
    [2, bhutan], [4, bhutan], [5, bhutan], [6, bhutan],
    [1, correct], [7, correct], [8, correct],
    ...Array.from({ length: 12 }, (_, k) => [14 + k, correct] as [number, string]),
  ];
  for (const i of [9, 10, 11, 12]) if (i !== raceWinner && plan.filter(([, o]) => o === ny).length < 2) plan.push([i, ny]);
  const results = await Promise.all(plan.map(([i, o]) => vote(i, o)));
  for (const r of results) assert.equal(r.status, 200, r.text);

  const hostVotes = await call('GET', `/api/games/${roomCode}/state`, undefined, hostToken);
  check('host ziet stemvoortgang maar geen keuzes', () => {
    assert.equal(hostVotes.json.voteProgress.filter((x: Json) => x.done).length, plan.length + 1);
    assert.ok(!('myVoteOptionId' in hostVotes.json) || hostVotes.json.myVoteOptionId == null);
  });

  // ---------- Onthullen (dubbelklik) ----------
  const reveals = await Promise.all([hostAction('reveal'), hostAction('reveal'), hostAction('reveal')]);
  check('onthullen wordt maar één keer uitgevoerd', () => assert.equal(reveals.filter((r) => r.status === 200).length, 1));

  const rv = await state(2);
  check('na onthulling is het juiste antwoord zichtbaar', () => {
    assert.equal(rv.json.status, 'REVEAL');
    assert.equal(rv.json.reveal.correctAnswer, 'Nepal');
  });
  const pts = new Map<string, number>(rv.json.reveal.roundPoints.map((x: Json) => [x.id, x.points]));
  const bhutanOpt = rv.json.reveal.options.find((o: Json) => o.text === 'Bhutan');
  check('auteur en stemmers van een nepantwoord zichtbaar', () => {
    assert.equal(bhutanOpt.author.name, p[1].name);
    assert.equal(bhutanOpt.voters.length, p0Correct ? 4 : 5);
    assert.equal(bhutanOpt.authorPoints, p0Correct ? 4 : 5);
  });
  check('punten: speler 1 = stemmen op Bhutan + 2 voor het juiste antwoord', () =>
    assert.equal(pts.get(p[1].id), (p0Correct ? 4 : 5) + 2),
  );
  check('punten: juist geraden, niemand trapte in eigen antwoord = 2', () => assert.equal(pts.get(p[14].id), 2));
  if (p0Correct) check('punten: speler zonder nepantwoord die goed raadt krijgt 2', () => assert.equal(pts.get(p[0].id), 2));
  check('punten: niet gestemd en geen antwoord = 0', () => assert.equal(pts.get(p[27].id), 0));
  check('punten: gestemd op nepantwoord = 0 (geen minpunten)', () => assert.equal(pts.get(p[2].id), 0));
  const winnerGuessedRight = plan.some(([i, o]) => i === raceWinner && o === correct);
  check('punten: bedenker van New York krijgt 1 per stem', () =>
    assert.equal(pts.get(p[raceWinner].id), 2 + (winnerGuessedRight ? 2 : 0)),
  );

  // ---------- Tussenstand en vraag 2 ----------
  assert.equal((await hostAction('nextQuestion')).json.code, 'INVALID_STATE');
  assert.equal((await hostAction('scoreboard')).status, 200);
  const sb = await state(1);
  check('tussenstand gesorteerd, speler 1 bovenaan', () => {
    assert.equal(sb.json.status, 'SCOREBOARD');
    assert.equal(sb.json.standings[0].id, p[1].id);
    const scores = sb.json.standings.map((s: Json) => s.score);
    assert.deepEqual(scores, [...scores].sort((a: number, b: number) => b - a));
  });
  check('niet de laatste vraag', () => assert.equal(sb.json.isLastQuestion, false));
  assert.equal((await hostAction('finish')).json.code, 'QUESTIONS_LEFT');

  assert.equal((await hostAction('nextQuestion')).status, 200);
  const q2 = await state(0);
  check('vraag 2 van 2', () => assert.equal(q2.json.question.number, 2));
  assertNoSecret(q2.text, 'Canberra', 'vraag 2');
  const bhutan2 = await answer(2, 'Bhutan');
  check('Bhutan mag in vraag 2 opnieuw (uniek per vraag)', () => assert.equal(bhutan2.status, 200));
  assert.equal((await answer(3, 'canberra')).json.code, 'CORRECT_ANSWER');
  assert.equal((await answer(4, 'Sydney')).status, 200);

  // host gaat door zonder dat iedereen antwoordde
  assert.equal((await hostAction('openVoting')).status, 200);
  const v2 = await state(5);
  check('stemfase vraag 2: 3 opties', () => assert.equal(v2.json.options.length, 3));
  const sydney = v2.json.options.find((o: Json) => o.text === 'Sydney').id;
  await Promise.all([5, 6, 7].map((i) => vote(i, sydney)));
  // host onthult voordat iedereen stemde
  assert.equal((await hostAction('reveal')).status, 200);
  const rv2 = await state(4);
  check('vraag 2: bedenker van Sydney krijgt +3', () =>
    assert.equal(rv2.json.reveal.roundPoints.find((x: Json) => x.id === p[4].id).points, 3),
  );
  assert.equal((await hostAction('scoreboard')).status, 200);
  const sb2 = await state(4);
  check('laatste vraag gemarkeerd', () => assert.equal(sb2.json.isLastQuestion, true));
  assert.equal((await hostAction('nextQuestion')).json.code, 'NO_MORE_QUESTIONS');
  assert.equal((await hostAction('finish')).status, 200);

  const fin = await state(4);
  check('eindstand: totaal = som van beide rondes', () => {
    assert.equal(fin.json.status, 'FINISHED');
    const r1 = pts.get(p[4].id)!;
    assert.equal(fin.json.standings.find((s: Json) => s.id === p[4].id).score, r1 + 3);
  });

  // ---------- Opnieuw spelen ----------
  assert.equal((await hostAction('restart')).status, 200);
  const re = await call('GET', `/api/games/${roomCode}/state`, undefined, hostToken);
  check('opnieuw spelen: lobby met dezelfde spelers', () => {
    assert.equal(re.json.status, 'LOBBY');
    assert.equal(re.json.players.length, 30);
  });
  assert.equal((await hostAction('start')).status, 200);
  const again1 = await answer(1, 'Bhutan');
  check('na herstart kan hetzelfde antwoord weer (oude data gewist)', () => assert.equal(again1.status, 200));
  const me1 = await state(1);
  check('na herstart staan scores op 0', () => assert.equal(me1.json.me.score, 0));

  // ---------- Beëindigen ----------
  assert.equal((await hostAction('close')).status, 200);
  const closed = await state(1);
  check('na beëindigen ziet de speler status CLOSED', () => assert.equal(closed.json.status, 'CLOSED'));
  const joinClosed = await call('POST', `/api/games/${roomCode}/join`, { name: 'Nieuw' });
  check('meedoen met beëindigd spel geweigerd', () => assert.equal(joinClosed.json.code, 'GAME_NOT_FOUND'));

  for (const t of realtimePayloads) for (const s of SECRETS) assertNoSecret(t, s, 'realtime-bericht');
  check(`realtime-berichten bevatten geen speldata (${refreshEvents} ontvangen)`, () => assert.ok(refreshEvents > 10));

  await rt.removeAllChannels();
  console.log(`\nAlle ${passed} controles geslaagd.`);
}

main().catch((err) => {
  console.error('\n✗ MISLUKT:', err);
  process.exit(1);
});
