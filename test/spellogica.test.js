'use strict';

// Tests gebruiken vaste testvragen (5 per ronde), los van content/vragen.js.
process.env.CONTENT_FILE = require('path').join(__dirname, 'testvragen.js');

const test = require('node:test');
const assert = require('node:assert/strict');
const { GameStore } = require('../server/game');

function opzet(aantal = 3) {
  let nu = 1_000_000;
  const store = new GameStore({ now: () => nu });
  const { code } = store.createGame();
  const host = { role: 'host' };
  const spelers = [];
  for (let i = 0; i < aantal; i++) {
    const r = store.join(code, `P${i}`);
    spelers.push({ role: 'player', playerId: r.playerId });
  }
  const game = store.get(code);
  const host_ = (type, extra = {}) => store.act(code, host, type, { step: game.step, ...extra });
  const speler = (i, type, extra = {}) => store.act(code, spelers[i], type, { step: game.step, ...extra });
  return { store, code, game, host: host_, speler, spelers, klok: (ms) => (nu += ms), done: () => store.clearTimer(code) };
}

test('ronde 2: antwoord na de deadline wordt geweigerd, ook als de timer nog niet afging', () => {
  const s = opzet();
  s.host('start');
  for (let i = 0; i < 5; i++) {
    s.host('next');
    if (i < 4) {
      s.host('closeAnswers');
      if (s.game.phase === 'vote') s.host('closeVotes');
    }
  }
  // na 5 psych-vragen: resultaat → naar intro ronde 2 → eerste vraag
  s.host('closeAnswers');
  s.host('next');
  assert.equal(s.game.phase, 'intro');
  s.host('next');
  assert.equal(s.game.phase, 'answer');
  assert.equal(s.store.round(s.game).type, 'kennis');
  s.speler(0, 'answer', { text: 'Op tijd' });
  s.klok(30_001);
  assert.throws(() => s.speler(1, 'answer', { text: 'Te laat' }), /tijd is om/);
  assert.equal(Object.keys(s.game.q.answers).length, 1);
  s.done();
});

test('psych: gelijke stand geeft meerdere winnaars', () => {
  const s = opzet(2);
  s.host('start');
  s.host('next');
  s.speler(0, 'answer', { text: 'A' });
  s.speler(1, 'answer', { text: 'B' });
  assert.equal(s.game.phase, 'vote');
  const optie = (tekst) => s.game.q.options.find((o) => o.text === tekst).id;
  s.speler(0, 'vote', { optionId: optie('B') });
  s.speler(1, 'vote', { optionId: optie('A') });
  assert.equal(s.game.phase, 'result');
  // Rest van het spel zonder punten doorlopen.
  while (s.game.phase !== 'final') {
    if (s.game.phase === 'answer') s.host('closeAnswers');
    else if (s.game.phase === 'vote') s.host('closeVotes');
    else if (s.game.phase === 'review' || s.game.phase === 'statement') s.host('confirmPoints', { selection: [] });
    else s.host('next');
  }
  const v = s.store.view(s.game, { role: 'host' });
  assert.deepEqual(
    v.ranking.map((r) => [r.name, r.total, r.rank, r.winner]),
    [
      ['P0', 1, 1, true],
      ['P1', 1, 1, true],
    ]
  );
  s.done();
});

test('wachtkamer: host kan verwijderen, speler kan verlaten, daarna is de naam weer vrij', () => {
  const s = opzet(3);
  s.host('kick', { playerId: s.spelers[1].playerId });
  assert.equal(s.game.players.length, 2);
  assert.throws(() => s.speler(1, 'answer', { text: 'x' }), /niet \(meer\) mee/);
  s.speler(2, 'leave');
  assert.equal(s.game.players.length, 1);
  assert.doesNotThrow(() => s.store.join(s.code, 'P2'));
  s.host('start');
  assert.throws(() => s.host('kick', { playerId: s.spelers[0].playerId }), /wachtkamer/);
});

test('verouderde stap of dubbele bevestiging kent nooit dubbel punten toe', () => {
  const s = opzet(2);
  s.host('start');
  // spring naar ronde 3
  while (!(s.game.phase === 'statement')) {
    if (s.game.phase === 'answer') s.host('closeAnswers');
    else if (s.game.phase === 'vote') s.host('closeVotes');
    else if (s.game.phase === 'review') s.host('confirmPoints', { selection: [] });
    else s.host('next');
  }
  const stap = s.game.step;
  const sel = [s.spelers[0].playerId, s.spelers[0].playerId, 'onbekend'];
  s.store.act(s.code, { role: 'host' }, 'confirmPoints', { step: stap, selection: sel });
  assert.throws(() => s.store.act(s.code, { role: 'host' }, 'confirmPoints', { step: stap, selection: sel }), /al verwerkt/);
  assert.deepEqual(s.game.players[0].scores, [0, 0, 3]);
  assert.deepEqual(s.game.players[1].scores, [0, 0, 0]);
});

test('lange en rare invoer wordt opgeschoond', () => {
  const s = opzet(1);
  assert.throws(() => s.store.join(s.code, '​ \n\t'), /naam/);
  const r = s.store.join(s.code, 'A'.repeat(50));
  assert.equal(s.game.players.find((p) => p.id === r.playerId).name.length, 20);
  s.host('start');
  s.host('next');
  s.speler(0, 'answer', { text: 'regel 1\nregel 2' + 'x'.repeat(500) });
  const antwoord = Object.values(s.game.q.answers)[0];
  assert.ok(antwoord.startsWith('regel 1 regel 2'));
  assert.ok(antwoord.length <= 150);
});
