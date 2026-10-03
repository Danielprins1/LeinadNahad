'use strict';

const { io } = require('socket.io-client');

class Client {
  constructor(url, label) {
    this.url = url;
    this.label = label;
    this.state = null;
    this.waiters = [];
    this.events = [];
    this.connect();
  }

  connect() {
    this.socket = io(this.url, { transports: ['websocket'], forceNew: true, reconnection: false });
    this.socket.on('state', (s) => {
      this.state = s;
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(s)) {
          clearTimeout(w.timer);
          w.resolve(s);
          return false;
        }
        return true;
      });
    });
    this.socket.on('session-ended', (e) => this.events.push(['session-ended', e]));
    return new Promise((resolve) => this.socket.on('connect', resolve));
  }

  ready() {
    return this.socket.connected ? Promise.resolve() : new Promise((r) => this.socket.once('connect', r));
  }

  emit(event, data) {
    return new Promise((resolve) => this.socket.emit(event, data, resolve));
  }

  act(type, extra = {}) {
    return this.emit('action', { type, step: this.state.step, ...extra });
  }

  waitFor(pred, ms = 4000) {
    if (this.state && pred(this.state)) return Promise.resolve(this.state);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      w.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        reject(new Error(`${this.label}: timeout bij wachten (fase=${this.state && this.state.phase}, stap=${this.state && this.state.step})`));
      }, ms);
      this.waiters.push(w);
    });
  }

  close() {
    this.socket.disconnect();
  }
}

const waitAll = (clients, pred, ms) => Promise.all(clients.map((c) => c.waitFor(pred, ms)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { Client, waitAll, sleep };
