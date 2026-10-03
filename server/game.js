'use strict';

/**
 * Spellogica. Alle regels (fases, rechten, deadlines, punten) worden hier
 * afgedwongen; de clients tonen alleen wat de server ze stuurt.
 */
const crypto = require('crypto');

const MAX_PLAYERS = 16;
const MIN_PLAYERS = 1;
const NAME_MAX = 20;
const ANSWER_MAX = 150;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // geen I/O: makkelijk over te nemen
const CODE_LENGTH = 4;
const MAX_GAMES = 2000;
const GAME_TTL_MS = 12 * 60 * 60 * 1000; // inactieve spellen na 12 uur opruimen
const POINTS = { vote: 1, correct: 3, statement: 3 };
const ROUND_TYPES = ['psych', 'kennis', 'stellingen'];

class GameError extends Error {}
const fail = (message) => {
  throw new GameError(message);
};

const randomToken = () => crypto.randomBytes(18).toString('base64url');
const randomId = () => crypto.randomBytes(6).toString('hex');

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

const nameKey = (name) => name.toLocaleLowerCase('nl-NL');

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function loadContent() {
  // Bij elk nieuw spel opnieuw inlezen, zodat aangepaste vragen meteen gelden.
  // CONTENT_FILE kan een ander vragenbestand aanwijzen (gebruikt door de tests).
  const file = require.resolve(process.env.CONTENT_FILE || '../content/vragen');
  delete require.cache[file];
  const rondes = require(file).rondes;
  if (!Array.isArray(rondes) || rondes.length !== 3) fail('content/vragen.js moet precies drie rondes bevatten.');
  const override = Number(process.env.R2_SECONDS);
  return rondes.map((r, i) => {
    // Een vraag is een tekst, of { tekst, fotos: ['bestand.jpg'] } met foto's uit public/fotos/.
    const items = (r.vragen || r.stellingen || [])
      .map((t) => {
        const item = t && typeof t === 'object' ? t : { tekst: t };
        const images = (Array.isArray(item.fotos) ? item.fotos : [])
          .map(String)
          .filter((f) => /^[\w.-]+\.(jpe?g|png|webp|gif)$/i.test(f));
        return { text: String(item.tekst ?? '').trim(), images };
      })
      .filter((item) => item.text);
    if (!items.length) fail(`Ronde ${i + 1} in content/vragen.js heeft geen vragen.`);
    return {
      type: ROUND_TYPES[i],
      titel: String(r.titel || `Ronde ${i + 1}`),
      uitleg: String(r.uitleg || ''),
      items,
      seconds: i === 1 ? (override > 0 ? override : Number(r.tijdslimietSeconden) || 30) : null,
    };
  });
}

class GameStore {
  constructor({ onChange = () => {}, onRemoved = () => {}, now = Date.now } = {}) {
    this.games = new Map();
    this.timers = new Map();
    this.connections = new Map();
    this.onChange = onChange;
    this.onRemoved = onRemoved;
    this.now = now;
  }

  // ---------- opzoeken & verbinding ----------

  find(code) {
    return this.games.get(String(code || '').trim().toUpperCase());
  }

  get(code) {
    const game = this.find(code);
    if (!game) fail('Spel niet gevonden. Controleer de spelcode.');
    return game;
  }

  changed(game) {
    game.updatedAt = this.now();
    this.onChange(game);
  }

  connKey(code, who) {
    return `${code}:${who}`;
  }

  setConnected(code, who, delta) {
    const key = this.connKey(code, who);
    const n = Math.max(0, (this.connections.get(key) || 0) + delta);
    if (n) this.connections.set(key, n);
    else this.connections.delete(key);
    const game = this.find(code);
    if (game) this.onChange(game);
  }

  isConnected(code, who) {
    return (this.connections.get(this.connKey(code, who)) || 0) > 0;
  }

  // ---------- aanmaken, deelnemen, hervatten ----------

  createGame() {
    if (this.games.size >= MAX_GAMES) fail('De server is vol. Probeer het later opnieuw.');
    let code;
    do {
      code = Array.from({ length: CODE_LENGTH }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
    } while (this.games.has(code));
    const now = this.now();
    const game = {
      code,
      hostToken: randomToken(),
      createdAt: now,
      updatedAt: now,
      gameNumber: 1,
      players: [],
      phase: 'lobby',
      round: 0,
      qIndex: 0,
      step: 0,
      content: loadContent(),
      q: null,
    };
    this.games.set(code, game);
    this.changed(game);
    return { code, token: game.hostToken };
  }

  join(code, rawName) {
    const game = this.get(code);
    if (game.phase !== 'lobby') fail('Dit spel is al begonnen. Nieuwe spelers kunnen niet meer meedoen.');
    const name = cleanText(rawName, NAME_MAX);
    if (!name) fail('Vul je naam in.');
    if (game.players.length >= MAX_PLAYERS) fail(`Dit spel zit vol (maximaal ${MAX_PLAYERS} spelers).`);
    if (game.players.some((p) => nameKey(p.name) === nameKey(name))) {
      fail('Deze naam is al in gebruik in dit spel. Kies een andere naam.');
    }
    const player = { id: randomId(), name, token: randomToken(), scores: [0, 0, 0] };
    game.players.push(player);
    this.changed(game);
    return { code: game.code, token: player.token, playerId: player.id, name };
  }

  resume(code, token) {
    const game = this.get(code);
    if (safeEqual(token, game.hostToken)) return { code: game.code, role: 'host' };
    const player = game.players.find((p) => safeEqual(token, p.token));
    if (!player) fail('Je sessie is niet meer geldig. Doe opnieuw mee met de spelcode.');
    return { code: game.code, role: 'player', playerId: player.id, name: player.name };
  }

  // ---------- acties ----------

  act(code, identity, type, payload = {}) {
    const game = this.get(code);
    if (!identity) fail('Je bent niet verbonden met dit spel.');
    payload = payload && typeof payload === 'object' ? payload : {};

    if (HOST_ACTIONS[type]) {
      if (identity.role !== 'host') fail('Alleen de host kan dit doen.');
      // Iedere hostactie hoort bij een specifieke stap. Dubbelklikken of een
      // verouderd scherm kan zo nooit twee keer dezelfde overgang uitvoeren.
      if (payload.step !== game.step) fail('Deze actie is al verwerkt.');
      HOST_ACTIONS[type].call(this, game, payload);
      return {};
    }
    if (PLAYER_ACTIONS[type]) {
      if (identity.role !== 'player') fail('De host speelt niet mee.');
      const player = game.players.find((p) => p.id === identity.playerId);
      if (!player) fail('Je doet niet (meer) mee aan dit spel.');
      if (payload.step !== game.step) fail('Deze vraag is al gesloten.');
      PLAYER_ACTIONS[type].call(this, game, player, payload);
      return {};
    }
    fail('Onbekende actie.');
  }

  round(game) {
    return game.content[game.round];
  }

  advance(game, phase) {
    game.phase = phase;
    game.step += 1;
  }

  startQuestion(game) {
    const round = this.round(game);
    game.q = {
      text: round.items[game.qIndex].text,
      images: round.items[game.qIndex].images,
      answers: {},
      options: [],
      votes: {},
      deadline: null,
      selected: [],
      awarded: null,
    };
    if (round.type === 'stellingen') {
      this.advance(game, 'statement');
    } else {
      if (round.type === 'kennis') game.q.deadline = this.now() + round.seconds * 1000;
      this.advance(game, 'answer');
      this.armTimer(game);
    }
  }

  armTimer(game) {
    this.clearTimer(game.code);
    if (game.phase !== 'answer' || !game.q || !game.q.deadline) return;
    const step = game.step;
    const fire = () => {
      this.timers.delete(game.code);
      if (this.games.get(game.code) === game && game.step === step && game.phase === 'answer') {
        this.closeAnswers(game);
        this.changed(game);
      }
    };
    const delay = Math.max(0, game.q.deadline - this.now());
    this.timers.set(game.code, setTimeout(fire, delay + 50));
  }

  clearTimer(code) {
    clearTimeout(this.timers.get(code));
    this.timers.delete(code);
  }

  closeAnswers(game) {
    this.clearTimer(game.code);
    const type = this.round(game).type;
    if (type === 'kennis') {
      this.advance(game, 'review');
      return;
    }
    // Psych: anonieme opties in een willekeurige, voor iedereen gelijke volgorde.
    game.q.options = shuffle(Object.entries(game.q.answers)).map(([authorId, text]) => ({
      id: randomId(),
      authorId,
      text,
    }));
    this.advance(game, 'vote');
    this.maybeFinishVotes(game);
  }

  canVote(game, playerId) {
    return game.q.options.some((o) => o.authorId !== playerId);
  }

  maybeFinishVotes(game) {
    const eligible = game.players.filter((p) => this.canVote(game, p.id));
    if (eligible.every((p) => p.id in game.q.votes)) this.finishVotes(game);
  }

  finishVotes(game) {
    const awarded = {};
    for (const [voterId, optionId] of Object.entries(game.q.votes)) {
      const option = game.q.options.find((o) => o.id === optionId);
      // Alleen geldige stemmen tellen: bestaande optie, niet op jezelf.
      if (!option || option.authorId === voterId) continue;
      awarded[option.authorId] = (awarded[option.authorId] || 0) + POINTS.vote;
    }
    this.award(game, awarded);
    this.advance(game, 'result');
  }

  award(game, awarded) {
    // Enige plek waar punten worden opgeteld; wordt per vraag precies één keer
    // aangeroepen vanuit een faseovergang die zelf maar één keer kan plaatsvinden.
    if (game.q.awarded) fail('Punten voor deze vraag zijn al toegekend.');
    for (const p of game.players) {
      if (awarded[p.id]) p.scores[game.round] += awarded[p.id];
    }
    game.q.awarded = awarded;
  }

  validSelection(game, selection) {
    if (!Array.isArray(selection)) fail('Ongeldige selectie.');
    const ids = new Set(selection.filter((id) => typeof id === 'string'));
    return game.players
      .filter((p) => ids.has(p.id))
      .filter((p) => game.phase !== 'review' || p.id in game.q.answers)
      .map((p) => p.id);
  }

  // ---------- onderhoud ----------

  cleanup() {
    const cutoff = this.now() - GAME_TTL_MS;
    for (const game of [...this.games.values()]) {
      if (game.updatedAt < cutoff) {
        this.clearTimer(game.code);
        this.games.delete(game.code);
        this.onRemoved(game);
      }
    }
  }

  serialize() {
    return [...this.games.values()];
  }

  restore(games) {
    for (const game of games || []) {
      if (!game || typeof game.code !== 'string') continue;
      this.games.set(game.code, game);
      if (game.phase === 'answer' && game.q && game.q.deadline) {
        // Was de deadline tijdens een herstart al verstreken, dan sluit de timer direct.
        this.armTimer(game);
      }
    }
  }

  // ---------- weergave per deelnemer ----------

  view(game, identity) {
    const isHost = identity.role === 'host';
    const me = isHost ? null : game.players.find((p) => p.id === identity.playerId);
    const round = this.round(game);
    const q = game.q;
    const phase = game.phase;
    const total = (p) => p.scores.reduce((a, b) => a + b, 0);
    const inQuestion = q && ['answer', 'vote', 'review', 'statement', 'result'].includes(phase);

    const v = {
      code: game.code,
      role: identity.role,
      me: me ? { id: me.id, name: me.name } : null,
      serverNow: this.now(),
      step: game.step,
      phase,
      gameNumber: game.gameNumber,
      round: game.round + 1,
      totalRounds: game.content.length,
      roundType: round.type,
      roundTitle: round.titel,
      roundUitleg: round.uitleg,
      qIndex: game.qIndex + 1,
      totalQ: round.items.length,
      answerSeconds: round.seconds,
      isLastQuestion: game.qIndex === round.items.length - 1,
      isLastRound: game.round === game.content.length - 1,
      maxPlayers: MAX_PLAYERS,
      minPlayers: MIN_PLAYERS,
      answerMax: ANSWER_MAX,
      hostConnected: this.isConnected(game.code, 'host'),
      players: game.players.map((p) => ({
        id: p.id,
        name: p.name,
        connected: this.isConnected(game.code, p.id),
        scores: [...p.scores],
        total: total(p),
        answered: !!(q && inQuestion && p.id in q.answers),
        voted: !!(q && phase === 'vote' && p.id in q.votes),
        canVote: !!(q && phase === 'vote' && this.canVote(game, p.id)),
      })),
    };

    if (inQuestion) {
      v.question = q.text;
      v.questionImages = q.images || [];
    }
    if (q && q.awarded && phase === 'result') v.awarded = q.awarded;

    if (phase === 'answer') {
      v.deadline = q.deadline;
      if (me) v.myAnswer = q.answers[me.id] ?? null;
    }

    if (phase === 'vote') {
      // Geen auteurs: alleen of de optie van jezelf is.
      v.options = q.options.map((o) => ({ id: o.id, text: o.text, mine: !!me && o.authorId === me.id }));
      if (me) {
        v.myVote = q.votes[me.id] ?? null;
        v.canVote = this.canVote(game, me.id);
      }
    }

    if (phase === 'result' && round.type === 'psych') {
      const counts = {};
      for (const optionId of Object.values(q.votes)) counts[optionId] = (counts[optionId] || 0) + 1;
      v.results = q.options
        .map((o) => {
          const author = game.players.find((p) => p.id === o.authorId);
          return {
            text: o.text,
            authorId: o.authorId,
            authorName: author ? author.name : 'Onbekend',
            votes: counts[o.id] || 0,
            mine: !!me && o.authorId === me.id,
          };
        })
        .sort((a, b) => b.votes - a.votes);
      if (me) v.myVote = q.votes[me.id] ?? null;
    }

    if ((phase === 'review' || phase === 'result') && round.type === 'kennis') {
      v.answers = game.players.map((p) => ({
        playerId: p.id,
        name: p.name,
        text: q.answers[p.id] ?? null,
        approved: phase === 'result' ? !!(q.awarded && q.awarded[p.id]) : undefined,
      }));
    }

    if (isHost && (phase === 'review' || phase === 'statement')) v.selected = [...q.selected];

    if (phase === 'final') {
      const ranked = [...game.players].sort((a, b) => total(b) - total(a) || a.name.localeCompare(b.name, 'nl'));
      const top = ranked.length ? total(ranked[0]) : 0;
      let lastTotal = null;
      let lastRank = 0;
      v.ranking = ranked.map((p, i) => {
        const t = total(p);
        if (t !== lastTotal) {
          lastRank = i + 1;
          lastTotal = t;
        }
        return { id: p.id, name: p.name, scores: [...p.scores], total: t, rank: lastRank, winner: t === top };
      });
      v.roundTitles = game.content.map((r) => r.titel);
    }

    return v;
  }
}

const HOST_ACTIONS = {
  kick(game, { playerId }) {
    if (game.phase !== 'lobby') fail('Spelers verwijderen kan alleen in de wachtkamer.');
    const before = game.players.length;
    game.players = game.players.filter((p) => p.id !== playerId);
    if (game.players.length === before) fail('Speler niet gevonden.');
    this.changed(game);
  },

  start(game) {
    if (game.phase !== 'lobby') fail('Het spel is al gestart.');
    if (game.players.length < MIN_PLAYERS) fail('Er moet minimaal één speler meedoen.');
    game.round = 0;
    game.qIndex = 0;
    this.advance(game, 'intro');
    this.changed(game);
  },

  next(game) {
    if (game.phase === 'intro') {
      this.startQuestion(game);
    } else if (game.phase === 'result') {
      const round = this.round(game);
      if (game.qIndex < round.items.length - 1) {
        game.qIndex += 1;
        this.startQuestion(game);
      } else if (game.round < game.content.length - 1) {
        game.round += 1;
        game.qIndex = 0;
        game.q = null;
        this.advance(game, 'intro');
      } else {
        game.q = null;
        this.advance(game, 'final');
      }
    } else {
      fail('Je kunt nu nog niet verder.');
    }
    this.changed(game);
  },

  closeAnswers(game) {
    if (game.phase !== 'answer') fail('De antwoordfase is al gesloten.');
    this.closeAnswers(game);
    this.changed(game);
  },

  closeVotes(game) {
    if (game.phase !== 'vote') fail('De stemfase is al gesloten.');
    this.finishVotes(game);
    this.changed(game);
  },

  select(game, { selection }) {
    if (game.phase !== 'review' && game.phase !== 'statement') fail('Er valt nu niets te selecteren.');
    game.q.selected = this.validSelection(game, selection);
    this.changed(game);
  },

  confirmPoints(game, { selection }) {
    if (game.phase !== 'review' && game.phase !== 'statement') fail('De punten zijn al bevestigd.');
    const ids = this.validSelection(game, selection);
    const pts = game.phase === 'review' ? POINTS.correct : POINTS.statement;
    game.q.selected = ids;
    this.award(game, Object.fromEntries(ids.map((id) => [id, pts])));
    this.advance(game, 'result');
    this.changed(game);
  },

  newGame(game) {
    if (game.phase !== 'final') fail('Een nieuw spel kan pas na de einduitslag.');
    this.clearTimer(game.code);
    for (const p of game.players) p.scores = [0, 0, 0];
    game.content = loadContent();
    game.round = 0;
    game.qIndex = 0;
    game.q = null;
    game.gameNumber += 1;
    this.advance(game, 'lobby');
    this.changed(game);
  },
};

const PLAYER_ACTIONS = {
  leave(game, player) {
    if (game.phase !== 'lobby') fail('Je kunt het spel alleen in de wachtkamer verlaten.');
    game.players = game.players.filter((p) => p !== player);
    this.changed(game);
  },

  answer(game, player, { text }) {
    if (game.phase !== 'answer') fail('Je kunt nu geen antwoord insturen.');
    if (game.q.deadline && this.now() > game.q.deadline) fail('De tijd is om. Je antwoord is niet meer ingestuurd.');
    if (player.id in game.q.answers) fail('Je hebt al een antwoord ingestuurd.');
    const clean = cleanText(text, ANSWER_MAX);
    if (!clean) fail('Een leeg antwoord kan niet worden ingestuurd.');
    game.q.answers[player.id] = clean;
    if (game.players.every((p) => p.id in game.q.answers)) this.closeAnswers(game);
    this.changed(game);
  },

  vote(game, player, { optionId }) {
    if (game.phase !== 'vote') fail('Je kunt nu niet stemmen.');
    if (player.id in game.q.votes) fail('Je hebt al gestemd.');
    const option = game.q.options.find((o) => o.id === optionId);
    if (!option) fail('Dit antwoord bestaat niet.');
    if (option.authorId === player.id) fail('Je kunt niet op je eigen antwoord stemmen.');
    game.q.votes[player.id] = option.id;
    this.maybeFinishVotes(game);
    this.changed(game);
  },
};

module.exports = { GameStore, GameError, MAX_PLAYERS, POINTS, ANSWER_MAX, NAME_MAX };
