'use strict';

// Tests gebruiken vaste testvragen (5 per ronde), los van content/vragen.js.
process.env.CONTENT_FILE = require('path').join(__dirname, 'testvragen.js');

/**
 * Volledige spelcyclus: 1 host + 16 gesimuleerde spelers via echte
 * Socket.IO-verbindingen tegen de echte server.
 */
process.env.R2_SECONDS = '2'; // korte timer voor ronde 2 in de test

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { start } = require('../server');
const { Client, waitAll, sleep } = require('./helpers');

const N = 16;

test('volledige spelcyclus met 16 spelers en een host', { timeout: 120_000 }, async (t) => {
  const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'feestspel-')), 'spellen.json');
  const server = await start({ port: 0, dataFile });
  const url = `http://localhost:${server.port}`;
  const all = [];
  const verwacht = {}; // naam -> [r1, r2, r3]
  const tel = (naam, ronde, pt) => (verwacht[naam][ronde] += pt);

  try {
    // ---------------- Aanmaken & deelnemen ----------------
    const host = new Client(url, 'host');
    all.push(host);
    await host.ready();
    const created = await host.emit('create');
    assert.equal(created.ok, true);
    assert.match(created.code, /^[A-Z]{4}$/);
    const code = created.code;
    await host.waitFor((s) => s.phase === 'lobby');
    assert.equal(host.state.role, 'host');

    const spelers = [];
    const sessies = {};
    for (let i = 0; i < N; i++) {
      const c = new Client(url, `speler${i + 1}`);
      all.push(c);
      await c.ready();
      if (i === 1) {
        const dubbel = await c.emit('join', { code, name: 'SPELER 1' });
        assert.equal(dubbel.ok, false, 'dubbele naam (hoofdletterongevoelig)');
        assert.match(dubbel.error, /al in gebruik/);
        assert.equal((await c.emit('join', { code, name: '   ' })).ok, false, 'lege naam');
      }
      const naam = i === 3 ? '<b>Bold</b>&amp;' : `Speler ${i + 1}`;
      const res = await c.emit('join', { code: code.toLowerCase(), name: `  ${naam}  ` });
      assert.equal(res.ok, true, res.error);
      assert.equal(res.name, naam);
      c.naam = naam;
      sessies[naam] = res;
      verwacht[naam] = [0, 0, 0];
      spelers.push(c);
    }

    await t.test('lege, dubbele en te veel spelers worden geweigerd', async () => {
      const extra = new Client(url, 'extra');
      all.push(extra);
      await extra.ready();
      const vol = await extra.emit('join', { code, name: 'Nummer 17' });
      assert.equal(vol.ok, false);
      assert.match(vol.error, /vol/);
      assert.equal((await extra.emit('join', { code: 'ZZZZ', name: 'X' })).ok, false);
      extra.close();
    });

    await waitAll([host, ...spelers], (s) => s.players.length === N && s.players.every((p) => p.connected));

    await t.test('spelers kunnen geen hostacties uitvoeren en de host speelt niet mee', async () => {
      const p = spelers[0];
      for (const type of ['start', 'next', 'closeAnswers', 'closeVotes', 'confirmPoints', 'kick', 'newGame', 'select']) {
        const res = await p.act(type, { selection: [p.state.me.id], playerId: spelers[1].state.me.id });
        assert.equal(res.ok, false, type);
        assert.match(res.error, /Alleen de host/);
      }
      const res = await host.act('answer', { text: 'hoi' });
      assert.equal(res.ok, false);
      // zonder sessie mag een socket niets
      const anoniem = new Client(url, 'anoniem');
      all.push(anoniem);
      await anoniem.ready();
      const r = await anoniem.emit('action', { type: 'start', step: 0 });
      assert.equal(r.ok, false);
      // een vervalst token levert geen toegang op
      const nep = await anoniem.emit('resume', { code, token: 'nep-token' });
      assert.equal(nep.ok, false);
      anoniem.close();
    });

    // ---------------- Start ----------------
    const startStep = host.state.step;
    const [r1, r2] = await Promise.all([host.act('start'), host.emit('action', { type: 'start', step: startStep })]);
    assert.equal([r1, r2].filter((r) => r.ok).length, 1, 'dubbel starten mag maar één keer slagen');
    await waitAll([host, ...spelers], (s) => s.phase === 'intro' && s.round === 1);

    await t.test('na de start kan niemand meer aansluiten', async () => {
      const laat = new Client(url, 'laat');
      all.push(laat);
      await laat.ready();
      const res = await laat.emit('join', { code, name: 'Laatkomer' });
      assert.equal(res.ok, false);
      assert.match(res.error, /al begonnen/);
      laat.close();
    });

    const id = (c) => c.state.me.id;
    const naamVan = Object.fromEntries(spelers.map((c) => [id(c), c.naam]));

    // ---------------- Ronde 1: Psych ----------------
    async function naarAntwoordfase() {
      await host.act('next');
      await waitAll([host, ...spelers], (s) => s.phase === 'answer');
    }

    async function controleerPsychUitslag(stemmen) {
      // stemmen: voterNaam -> auteurNaam
      const ontvangen = {};
      for (const auteur of Object.values(stemmen)) ontvangen[auteur] = (ontvangen[auteur] || 0) + 1;
      await waitAll([host, ...spelers], (s) => s.phase === 'result');
      for (const [naam, n] of Object.entries(ontvangen)) tel(naam, 0, n);
      for (const r of host.state.results) assert.equal(r.votes, ontvangen[r.authorName] || 0, r.authorName);
      for (const p of host.state.players) assert.deepEqual(p.scores, verwacht[p.name], p.name);
      // Iedereen ziet dezelfde uitslag
      const ref = JSON.stringify(host.state.results.map((r) => [r.text, r.authorName, r.votes]));
      for (const c of spelers) assert.equal(JSON.stringify(c.state.results.map((r) => [r.text, r.authorName, r.votes])), ref);
    }

    await host.waitFor((s) => s.phase === 'intro');
    await t.test('ronde 1, vraag 1: alle 16 antwoorden en stemmen', async () => {
      await naarAntwoordfase();
      assert.equal(host.state.roundType, 'psych');
      assert.equal(host.state.qIndex, 1);
      assert.match(host.state.question, /Daniel Dahan/);
      assert.equal(host.state.deadline, null, 'ronde 1 heeft geen timer');

      assert.equal((await spelers[0].act('answer', { text: '   ' })).ok, false, 'leeg antwoord geweigerd');
      for (let i = 0; i < N - 1; i++) {
        const res = await spelers[i].act('answer', { text: `Geheim antwoord ${i + 1}` });
        assert.equal(res.ok, true, res.error);
      }
      const dubbel = await spelers[0].act('answer', { text: 'Ander antwoord' });
      assert.equal(dubbel.ok, false, 'antwoord kan niet worden gewijzigd');

      // Tussentijds: niemand ziet antwoorden van anderen, wel wie heeft ingestuurd.
      await waitAll([host, ...spelers], (s) => s.players.filter((p) => p.answered).length === N - 1);
      for (const c of [host, ...spelers]) {
        const json = JSON.stringify(c.state);
        for (let i = 0; i < N - 1; i++) {
          if (c === spelers[i]) continue;
          assert.ok(!json.includes(`Geheim antwoord ${i + 1}"`), `${c.label} ziet antwoord ${i + 1}`);
        }
      }
      assert.equal(spelers[0].state.myAnswer, 'Geheim antwoord 1');

      await spelers[N - 1].act('answer', { text: `Geheim antwoord ${N}` });
      // Automatisch naar stemfase
      await waitAll([host, ...spelers], (s) => s.phase === 'vote');

      // Zelfde volgorde op alle telefoons, geen auteurs zichtbaar.
      const volgorde = JSON.stringify(host.state.options.map((o) => [o.id, o.text]));
      for (const c of spelers) {
        assert.equal(JSON.stringify(c.state.options.map((o) => [o.id, o.text])), volgorde);
        assert.equal(c.state.options.filter((o) => o.mine).length, 1);
        assert.ok(!JSON.stringify(c.state.options).includes('author'));
      }
      assert.ok(host.state.options.every((o) => o.mine === false));

      // Iedereen probeert eerst op zichzelf te stemmen.
      for (const c of spelers) {
        const eigen = c.state.options.find((o) => o.mine);
        const res = await c.act('vote', { optionId: eigen.id });
        assert.equal(res.ok, false);
        assert.match(res.error, /eigen antwoord/);
      }
      assert.equal((await spelers[0].act('vote', { optionId: 'bestaat-niet' })).ok, false);
      assert.equal((await host.act('vote', { optionId: host.state.options[0].id })).ok, false, 'host stemt niet');

      // Stemplan: iedereen stemt op het antwoord van speler 1, behalve speler 1 zelf (op speler 2).
      const tekstVan = (i) => `Geheim antwoord ${i + 1}`;
      const stemmen = {};
      for (let i = 0; i < N; i++) {
        const doel = i === 0 ? 1 : 0;
        const optie = spelers[i].state.options.find((o) => o.text === tekstVan(doel));
        const res = await spelers[i].act('vote', { optionId: optie.id });
        assert.equal(res.ok, true, res.error);
        stemmen[spelers[i].naam] = spelers[doel].naam;
        if (i === 2) {
          const opnieuw = await spelers[2].act('vote', { optionId: spelers[2].state.options.find((o) => !o.mine).id });
          assert.equal(opnieuw.ok, false, 'stem kan niet worden gewijzigd');
          await waitAll([host], (s) => s.players.filter((p) => p.voted).length === 3);
          assert.ok(!JSON.stringify(host.state).includes(optie.id + '"voted'), 'stemkeuzes niet zichtbaar');
        }
      }
      await controleerPsychUitslag(stemmen);
      assert.equal(spelers[0].state.awarded[id(spelers[0])], N - 1);
    });

    await t.test('ronde 1, vraag 2: host sluit antwoorden en stemmen vroegtijdig', async () => {
      await host.act('next');
      await waitAll([host, ...spelers], (s) => s.phase === 'answer' && s.qIndex === 2);
      for (let i = 0; i < 10; i++) await spelers[i].act('answer', { text: `V2 antwoord ${i + 1}` });
      await host.waitFor((s) => s.players.filter((p) => p.answered).length === 10);
      // Dubbelklik op afsluiten: slechts één keer verwerkt.
      const stap = host.state.step;
      const res = await Promise.all([host.act('closeAnswers'), host.emit('action', { type: 'closeAnswers', step: stap })]);
      assert.equal(res.filter((r) => r.ok).length, 1);
      await waitAll([host, ...spelers], (s) => s.phase === 'vote');
      assert.equal(host.state.options.length, 10);
      // Speler zonder antwoord mag wel stemmen.
      const stemmen = {};
      for (const i of [12, 13, 0]) {
        const c = spelers[i];
        const optie = c.state.options.find((o) => o.text === 'V2 antwoord 5');
        assert.equal((await c.act('vote', { optionId: optie.id })).ok, true);
        stemmen[c.naam] = spelers[4].naam;
      }
      // Tijdens stemmen zijn auteurs nog niet bekend
      assert.ok(!('results' in spelers[0].state));
      await host.waitFor((s) => s.players.filter((p) => p.voted).length === 3);
      await host.act('closeVotes');
      await controleerPsychUitslag(stemmen);
      const laatStem = await spelers[5].emit('action', { type: 'vote', step: spelers[5].state.step - 1, optionId: 'x' });
      assert.equal(laatStem.ok, false, 'na sluiten geen stemmen meer');
    });

    await t.test('ronde 1, vraag 3: opnieuw verbinden behoudt identiteit en voortgang', async () => {
      await host.act('next');
      await waitAll([host, ...spelers], (s) => s.phase === 'answer' && s.qIndex === 3);
      const c = spelers[5];
      const oudId = id(c);
      const scoresVoor = host.state.players.find((p) => p.id === oudId).scores;
      await c.act('answer', { text: 'Voor het wegvallen' });
      c.close();
      await host.waitFor((s) => s.players.find((p) => p.id === oudId).connected === false);
      // Het spel loopt door; anderen antwoorden.
      for (let i = 0; i < N; i++) if (i !== 5) await spelers[i].act('answer', { text: `V3 antwoord ${i + 1}` });
      await host.waitFor((s) => s.phase === 'vote');
      // Opnieuw verbinden met hetzelfde token (zoals na verversen).
      await c.connect();
      const res = await c.emit('resume', { code, token: sessies[c.naam].token });
      assert.equal(res.ok, true);
      assert.equal(res.role, 'player');
      assert.equal(res.playerId, oudId);
      await c.waitFor((s) => s.phase === 'vote');
      assert.equal(c.state.me.id, oudId);
      assert.equal(c.state.players.length, N, 'geen nieuwe deelnemer');
      assert.deepEqual(c.state.players.find((p) => p.id === oudId).scores, scoresVoor);
      assert.equal(c.state.options.find((o) => o.mine).text, 'Voor het wegvallen');
      await host.waitFor((s) => s.players.find((p) => p.id === oudId).connected === true);

      // Host herlaadt ook.
      host.close();
      await host.connect();
      assert.equal((await host.emit('resume', { code, token: created.token })).role, 'host');
      await host.waitFor((s) => s.phase === 'vote');

      // Iedereen stemt op het antwoord van de volgende speler.
      const stemmen = {};
      for (let i = 0; i < N; i++) {
        const doel = (i + 1) % N;
        const tekst = doel === 5 ? 'Voor het wegvallen' : `V3 antwoord ${doel + 1}`;
        const optie = spelers[i].state.options.find((o) => o.text === tekst);
        assert.equal((await spelers[i].act('vote', { optionId: optie.id })).ok, true);
        stemmen[spelers[i].naam] = spelers[doel].naam;
      }
      await controleerPsychUitslag(stemmen);
    });

    await t.test('ronde 1, vraag 4: geen antwoorden → host kan verder', async () => {
      await host.act('next');
      await waitAll([host, ...spelers], (s) => s.phase === 'answer' && s.qIndex === 4);
      await host.act('closeAnswers');
      await waitAll([host, ...spelers], (s) => s.phase === 'result');
      assert.equal(host.state.results.length, 0);
      await controleerPsychUitslag({});
    });

    await t.test('ronde 1, vraag 5: één antwoord, auteur kan niet stemmen', async () => {
      await host.act('next');
      await waitAll([host, ...spelers], (s) => s.phase === 'answer' && s.qIndex === 5);
      await spelers[7].act('answer', { text: 'Enige antwoord' });
      await host.act('closeAnswers');
      await waitAll([host, ...spelers], (s) => s.phase === 'vote');
      assert.equal(spelers[7].state.canVote, false);
      assert.equal(host.state.players.find((p) => p.id === id(spelers[7])).canVote, false);
      const stemmen = {};
      for (let i = 0; i < N; i++) {
        if (i === 7) continue;
        await spelers[i].act('vote', { optionId: spelers[i].state.options[0].id });
        stemmen[spelers[i].naam] = spelers[7].naam;
      }
      // Automatisch klaar: alle stemgerechtigden hebben gestemd.
      await controleerPsychUitslag(stemmen);
      assert.equal(host.state.isLastQuestion, true);
    });

    // ---------------- Ronde 2: Algemene kennis ----------------
    await t.test('ronde 2, vraag 1: timer, late antwoorden, hostbeoordeling', async () => {
      await host.act('next');
      await waitAll([host, ...spelers], (s) => s.phase === 'intro' && s.round === 2);
      await host.act('next');
      await waitAll([host, ...spelers], (s) => s.phase === 'answer' && s.round === 2);
      const dl = host.state.deadline;
      assert.ok(dl - host.state.serverNow > 1500 && dl - host.state.serverNow <= 2000, 'deadline door server bepaald');
      for (const c of spelers) assert.equal(c.state.deadline, dl, 'zelfde deadline voor iedereen');

      for (let i = 0; i < 6; i++) await spelers[i].act('answer', { text: i % 2 ? 'Canberra' : 'Sydney' });
      // Host kan in ronde 2 de vraag niet goedkeuren tijdens de antwoordfase
      assert.equal((await host.act('confirmPoints', { selection: [] })).ok, false);

      const laatkomer = spelers[10];
      const stapTijdensAntwoord = laatkomer.state.step;
      await waitAll([host, ...spelers], (s) => s.phase === 'review', 4000);
      assert.ok(Date.now() >= dl - 100);
      const laat = await laatkomer.emit('action', { type: 'answer', step: stapTijdensAntwoord, text: 'Te laat' });
      assert.equal(laat.ok, false, 'na de deadline geen antwoorden');

      // Iedereen ziet alle antwoorden met namen; ontbrekend = null ('Geen antwoord').
      for (const c of spelers) {
        assert.equal(c.state.answers.length, N);
        assert.equal(c.state.answers.filter((a) => a.text === null).length, N - 6);
        assert.equal(c.state.answers.find((a) => a.playerId === id(spelers[1])).text, 'Canberra');
        assert.ok(!('selected' in c.state), 'spelers zien de conceptselectie niet');
      }
      // Speler kan niet beoordelen
      assert.equal((await spelers[1].act('confirmPoints', { selection: [id(spelers[1])] })).ok, false);

      // Host selecteert, past aan, en bevestigt; speler zonder antwoord kan niet goedgekeurd worden.
      await host.act('select', { selection: [id(spelers[0]), id(spelers[1])] });
      await host.waitFor((s) => s.selected.length === 2);
      await host.act('select', { selection: [id(spelers[1]), id(spelers[3]), id(spelers[5]), id(spelers[12])] });
      await host.waitFor((s) => s.selected.length === 3);
      const sel = [id(spelers[1]), id(spelers[3]), id(spelers[5]), id(spelers[12])];
      const stap = host.state.step;
      const res = await Promise.all([
        host.act('confirmPoints', { selection: sel }),
        host.emit('action', { type: 'confirmPoints', step: stap, selection: sel }),
        host.emit('action', { type: 'confirmPoints', step: stap, selection: sel }),
      ]);
      assert.equal(res.filter((r) => r.ok).length, 1, 'punten maar één keer');
      await waitAll([host, ...spelers], (s) => s.phase === 'result');
      for (const i of [1, 3, 5]) tel(spelers[i].naam, 1, 3);
      for (const p of host.state.players) assert.deepEqual(p.scores, verwacht[p.name], p.name);
      assert.equal(spelers[0].state.answers.filter((a) => a.approved).length, 3);
    });

    await t.test('ronde 2, vraag 2–5: sluit direct als iedereen heeft ingestuurd', async () => {
      for (let q = 2; q <= 5; q++) {
        await host.act('next');
        await waitAll([host, ...spelers], (s) => s.phase === 'answer' && s.qIndex === q);
        const t0 = Date.now();
        if (q === 2) {
          await Promise.all(spelers.map((c, i) => c.act('answer', { text: `Antwoord ${i}` })));
          await waitAll([host, ...spelers], (s) => s.phase === 'review');
          assert.ok(Date.now() - t0 < 1500, 'sloot vóór de deadline');
        } else {
          await waitAll([host, ...spelers], (s) => s.phase === 'review', 4000);
        }
        const sel = q === 2 ? [id(spelers[0])] : [];
        await host.act('confirmPoints', { selection: sel });
        if (q === 2) tel(spelers[0].naam, 1, 3);
        await waitAll([host, ...spelers], (s) => s.phase === 'result');
      }
      for (const p of host.state.players) assert.deepEqual(p.scores, verwacht[p.name], p.name);
    });

    // ---------------- Ronde 3: Stellingen ----------------
    await t.test('ronde 3: stellingen met handmatige punten', async () => {
      await host.act('next');
      await waitAll([host, ...spelers], (s) => s.phase === 'intro' && s.round === 3);

      // Plan de punten zo dat twee spelers precies gelijk bovenaan eindigen.
      const totaal = (n) => verwacht[n].reduce((a, b) => a + b, 0);
      const namen = Object.keys(verwacht);
      const L = Math.max(...namen.map(totaal));
      let plan = null;
      for (const x of namen) {
        for (const y of namen) {
          if (x === y || totaal(x) < totaal(y) || (totaal(x) - totaal(y)) % 3) continue;
          const g = (totaal(x) - totaal(y)) / 3;
          const a = Math.max(0, Math.ceil((L - totaal(x)) / 3));
          if (a + g <= 5 && (!plan || a + g < plan.a + plan.g)) plan = { x, y, a, g };
        }
      }
      assert.ok(plan, 'er is een plan voor een gelijke stand');

      for (let q = 1; q <= 5; q++) {
        await host.act('next');
        await waitAll([host, ...spelers], (s) => s.phase === 'statement' && s.qIndex === q);
        for (const c of spelers) assert.equal(c.state.question, host.state.question);
        assert.equal((await spelers[0].act('answer', { text: 'x' })).ok, false, 'niets in te vullen');

        const namenSel = [];
        if (q - 1 < plan.a) namenSel.push(plan.x);
        if (q - 1 < plan.a + plan.g) namenSel.push(plan.y);
        const sel = namenSel.map((n) => id(spelers.find((c) => c.naam === n)));
        // Host past de selectie eerst aan (iemand extra aan en weer uit).
        await host.act('select', { selection: [...sel, id(spelers[15])] });
        await host.act('select', { selection: sel });
        await host.act('confirmPoints', { selection: sel });
        for (const pid of sel) tel(naamVan[pid], 2, 3);
        await waitAll([host, ...spelers], (s) => s.phase === 'result');
        for (const pid of sel) assert.equal(spelers[0].state.awarded[pid], 3);
        assert.equal(Object.keys(spelers[0].state.awarded).length, sel.length);
        for (const p of host.state.players) assert.deepEqual(p.scores, verwacht[p.name], p.name);
      }
    });

    // ---------------- Einduitslag ----------------
    await t.test('einduitslag met punten per ronde en gedeelde winnaars', async () => {
      assert.equal((await host.act('next')).ok, true);
      await waitAll([host, ...spelers], (s) => s.phase === 'final');
      const totaal = (n) => verwacht[n].reduce((a, b) => a + b, 0);
      const max = Math.max(...Object.keys(verwacht).map(totaal));
      const winnaars = Object.keys(verwacht).filter((n) => totaal(n) === max).sort();
      for (const c of [host, ...spelers]) {
        const rk = c.state.ranking;
        assert.equal(rk.length, N);
        for (let i = 1; i < rk.length; i++) assert.ok(rk[i - 1].total >= rk[i].total, 'gesorteerd');
        for (const r of rk) {
          assert.deepEqual(r.scores, verwacht[r.name]);
          assert.equal(r.total, totaal(r.name));
        }
        assert.deepEqual(rk.filter((r) => r.winner).map((r) => r.name).sort(), winnaars);
        assert.ok(rk.filter((r) => r.winner).every((r) => r.rank === 1));
      }
      t.diagnostic(`winnaars: ${winnaars.join(', ')} met ${max} punten`);
      assert.ok(winnaars.length >= 2, 'test bedoeld voor gedeelde winnaars');
    });

    await t.test('nieuw spel met dezelfde spelers zet alles op nul', async () => {
      await host.act('newGame');
      await waitAll([host, ...spelers], (s) => s.phase === 'lobby' && s.gameNumber === 2);
      assert.equal(host.state.players.length, N);
      assert.ok(host.state.players.every((p) => p.total === 0 && p.scores.every((x) => x === 0)));
      await host.act('start');
      await host.act('next');
      await waitAll([host, ...spelers], (s) => s.phase === 'answer' && s.round === 1 && s.qIndex === 1);
      assert.equal(spelers[0].state.myAnswer, null, 'antwoorden gewist');
    });

    await t.test('spelerstekst wordt ongewijzigd als tekst doorgegeven', async () => {
      assert.ok(host.state.players.some((p) => p.name === '<b>Bold</b>&amp;'));
    });

    // ---------------- Herstart van de server ----------------
    await t.test('spelstatus overleeft een herstart van de server', async () => {
      const stapVoor = host.state.step;
      for (const c of all) c.close();
      await server.close();
      const server2 = await start({ port: 0, dataFile });
      try {
        const c = new Client(`http://localhost:${server2.port}`, 'na-herstart');
        await c.ready();
        const res = await c.emit('resume', { code, token: sessies['Speler 1'].token });
        assert.equal(res.ok, true);
        await c.waitFor((s) => s.step === stapVoor && s.phase === 'answer');
        assert.equal(c.state.players.length, N);
        c.close();
      } finally {
        await server2.close();
      }
    });
  } finally {
    for (const c of all) c.close();
    await server.close().catch(() => {});
  }
});
