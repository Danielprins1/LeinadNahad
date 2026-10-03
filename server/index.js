'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const { GameStore, GameError } = require('./game');

function createPersistence(file) {
  if (!file) return { load: () => [], save: () => {}, flush: () => {} };
  let timer = null;
  let getData = null;
  const write = () => {
    timer = null;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(getData()));
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error('Opslaan mislukt:', err.message);
    }
  };
  return {
    load() {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        return [];
      }
    },
    save(fn) {
      getData = fn;
      if (!timer) timer = setTimeout(write, 300);
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        write();
      }
    },
  };
}

function start({ port = Number(process.env.PORT) || 3000, dataFile = process.env.DATA_FILE } = {}) {
  if (dataFile === undefined) dataFile = path.join(__dirname, '..', 'data', 'spellen.json');
  const persistence = createPersistence(dataFile || null);

  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  const server = http.createServer(app);
  const io = new Server(server, {
    pingInterval: 10000,
    pingTimeout: 8000,
    maxHttpBufferSize: 10_000,
  });

  const pending = new Set();
  const room = (code) => `spel:${code}`;
  const identityKey = (identity) => (identity.role === 'host' ? 'host' : identity.playerId);

  const store = new GameStore({
    onChange(game) {
      persistence.save(() => store.serialize());
      // Meerdere wijzigingen binnen dezelfde tick worden één update.
      if (pending.has(game.code)) return;
      pending.add(game.code);
      setImmediate(() => {
        pending.delete(game.code);
        broadcast(game.code);
      });
    },
    onRemoved(game) {
      persistence.save(() => store.serialize());
      io.in(room(game.code)).emit('session-ended', { message: 'Dit spel is beëindigd.' });
      io.in(room(game.code)).socketsLeave(room(game.code));
    },
  });
  store.restore(persistence.load());

  function broadcast(code) {
    const game = store.find(code);
    const ids = io.sockets.adapter.rooms.get(room(code));
    if (!game || !ids) return;
    for (const id of ids) {
      const socket = io.sockets.sockets.get(id);
      if (!socket || !socket.data.identity) continue;
      const { identity } = socket.data;
      if (identity.role === 'player' && !game.players.some((p) => p.id === identity.playerId)) {
        socket.emit('session-ended', { message: 'Je bent uit het spel verwijderd.' });
        unbind(socket);
        continue;
      }
      socket.emit('state', store.view(game, identity));
    }
  }

  function bind(socket, code, identity) {
    unbind(socket);
    socket.data.code = code;
    socket.data.identity = identity;
    socket.join(room(code));
    store.setConnected(code, identityKey(identity), +1);
  }

  function unbind(socket) {
    const { code, identity } = socket.data;
    if (!code) return;
    socket.leave(room(code));
    socket.data.code = null;
    socket.data.identity = null;
    store.setConnected(code, identityKey(identity), -1);
  }

  function handle(socket, ack, fn) {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      reply({ ok: true, ...(fn() || {}) });
    } catch (err) {
      if (!(err instanceof GameError)) console.error(err);
      reply({ ok: false, error: err instanceof GameError ? err.message : 'Er ging iets mis. Probeer het opnieuw.' });
    }
  }

  // Eenvoudige bescherming tegen spammen van acties.
  function rateLimited(socket) {
    const now = Date.now();
    const bucket = socket.data.bucket || (socket.data.bucket = { start: now, count: 0 });
    if (now - bucket.start > 5000) {
      bucket.start = now;
      bucket.count = 0;
    }
    return ++bucket.count > 60;
  }

  io.on('connection', (socket) => {
    const guard = (handler) => (payload, ack) => {
      if (rateLimited(socket)) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Rustig aan! Probeer het zo opnieuw.' });
        return;
      }
      handler(payload && typeof payload === 'object' ? payload : {}, ack);
    };

    socket.on(
      'create',
      guard((_payload, ack) =>
        handle(socket, ack, () => {
          const result = store.createGame();
          bind(socket, result.code, { role: 'host' });
          return { code: result.code, token: result.token, role: 'host' };
        })
      )
    );

    socket.on(
      'join',
      guard(({ code, name }, ack) =>
        handle(socket, ack, () => {
          const result = store.join(code, name);
          bind(socket, result.code, { role: 'player', playerId: result.playerId });
          return { code: result.code, token: result.token, role: 'player', name: result.name };
        })
      )
    );

    socket.on(
      'resume',
      guard(({ code, token }, ack) =>
        handle(socket, ack, () => {
          const result = store.resume(code, token);
          bind(socket, result.code, { role: result.role, playerId: result.playerId });
          return result;
        })
      )
    );

    socket.on(
      'action',
      guard(({ type, ...payload }, ack) =>
        handle(socket, ack, () => {
          const { code, identity } = socket.data;
          if (!code) throw new GameError('Je bent niet verbonden met een spel. Ververs de pagina.');
          store.act(code, identity, String(type), payload);
          if (type === 'leave') unbind(socket);
        })
      )
    );

    socket.on('leave-session', () => unbind(socket));
    socket.on('disconnect', () => unbind(socket));
  });

  app.get('/health', (_req, res) => res.json({ ok: true, games: store.games.size }));

  app.get('/qr/:code.svg', async (req, res) => {
    const code = String(req.params.code).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8);
    const url = `${req.protocol}://${req.get('host')}/?code=${code}`;
    try {
      const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
    } catch {
      res.status(500).end();
    }
  });

  app.use(
    express.static(path.join(__dirname, '..', 'public'), {
      setHeaders: (res) => res.set('Cache-Control', 'no-cache'),
    })
  );

  const cleanupTimer = setInterval(() => store.cleanup(), 10 * 60 * 1000);
  cleanupTimer.unref();

  return new Promise((resolve) => {
    server.listen(port, () => {
      const actualPort = server.address().port;
      resolve({
        port: actualPort,
        store,
        io,
        close: () =>
          new Promise((done) => {
            clearInterval(cleanupTimer);
            for (const code of store.timers.keys()) store.clearTimer(code);
            persistence.flush();
            io.close(() => done());
          }),
      });
    });
  });
}

if (require.main === module) {
  start().then(({ port, close }) => {
    console.log(`Feestspel draait op http://localhost:${port}`);
    const stop = () => close().then(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
}

module.exports = { start };
