/* global io */
(() => {
  'use strict';

  const SESSIE_SLEUTEL = 'feestspel-sessie';
  const app = document.getElementById('app');
  const verbindingBalk = document.getElementById('verbinding');
  const meldingen = document.getElementById('meldingen');

  // ---------------------------------------------------------------------------
  // DOM-hulp: alle tekst gaat via text nodes, nooit via innerHTML.
  // ---------------------------------------------------------------------------
  function h(tag, props, ...kinderen) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    el.append(...nodes(kinderen));
    return el;
  }

  function nodes(list) {
    const out = [];
    for (const k of [].concat(list).flat(Infinity)) {
      if (k === null || k === undefined || k === false) continue;
      out.push(k instanceof Node ? k : document.createTextNode(String(k)));
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Sessie: sessionStorage voor verversen in hetzelfde tabblad,
  // localStorage om na het sluiten van de browser terug te kunnen keren.
  // ---------------------------------------------------------------------------
  const opslag = {
    lees(soort) {
      try {
        return JSON.parse(window[soort].getItem(SESSIE_SLEUTEL));
      } catch {
        return null;
      }
    },
    schrijf(sessie) {
      for (const soort of ['sessionStorage', 'localStorage']) {
        try {
          window[soort].setItem(SESSIE_SLEUTEL, JSON.stringify(sessie));
        } catch {
          /* privémodus: dan alleen in geheugen */
        }
      }
    },
    wis() {
      for (const soort of ['sessionStorage', 'localStorage']) {
        try {
          window[soort].removeItem(SESSIE_SLEUTEL);
        } catch {
          /* negeren */
        }
      }
    },
  };

  let sessie = opslag.lees('sessionStorage');
  let bewaardeSessie = sessie ? null : opslag.lees('localStorage');

  // ---------------------------------------------------------------------------
  // Toestand
  // ---------------------------------------------------------------------------
  let view = null;
  let klokVerschil = 0;
  let huidigeSleutel = null;
  let regios = [];
  let lokaal = {};
  let ooitVerbonden = false;
  let codeUitLinkGebruikt = false;

  const socket = io({ reconnectionDelay: 500, reconnectionDelayMax: 3000 });

  function melding(tekst, soort = '') {
    const el = h('div', { class: `melding ${soort}` }, tekst);
    meldingen.append(el);
    setTimeout(() => el.remove(), soort === 'fout' ? 4500 : 2800);
  }

  function verbindingStatus(tekst, ok = false) {
    if (!tekst) {
      verbindingBalk.hidden = true;
      return;
    }
    verbindingBalk.hidden = false;
    verbindingBalk.textContent = tekst;
    verbindingBalk.classList.toggle('ok', ok);
  }

  function verzend(event, data) {
    return new Promise((resolve) => {
      if (!socket.connected) {
        resolve({ ok: false, error: 'Geen verbinding. Even geduld, we verbinden opnieuw…' });
        return;
      }
      socket.timeout(8000).emit(event, data, (err, res) => {
        resolve(err ? { ok: false, error: 'De server reageert niet. Probeer het opnieuw.' } : res);
      });
    });
  }

  // Voert een actie uit met een knop die tijdens het versturen geblokkeerd is.
  async function actie(knop, type, extra = {}, bezigTekst, { stil = false } = {}) {
    if (knop && knop.disabled) return { ok: false };
    const oud = knop ? knop.textContent : '';
    if (knop) {
      knop.disabled = true;
      if (bezigTekst) knop.textContent = bezigTekst;
    }
    const res = await verzend('action', { type, step: view ? view.step : -1, ...extra });
    if (!res.ok) {
      if (!stil) melding(res.error, 'fout');
      if (knop && knop.isConnected) {
        knop.disabled = false;
        knop.textContent = oud;
      }
    }
    return res;
  }

  // ---------------------------------------------------------------------------
  // Confetti (eigen, lichte canvas-animatie; uit bij 'verminderde beweging')
  // ---------------------------------------------------------------------------
  const confetti = (() => {
    const kleuren = ['#3b8fc4', '#24607f', '#f2c14e', '#ff6b8b', '#7cc8f0', '#2ec4a0', '#ffffff'];
    const rustig = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let canvas = null;
    let ctx = null;
    let deeltjes = [];
    let loopt = false;

    function maat() {
      const d = window.devicePixelRatio || 1;
      canvas.width = innerWidth * d;
      canvas.height = innerHeight * d;
      ctx.setTransform(d, 0, 0, d, 0, 0);
    }

    function stoot({ aantal = 80, x = 0.5, y = 0.4, richting = -90, spreiding = 60, kracht = 12 } = {}) {
      if (rustig) return;
      if (!canvas) {
        canvas = h('canvas', { class: 'confetti', 'aria-hidden': 'true' });
        document.body.append(canvas);
        ctx = canvas.getContext('2d');
        maat();
        addEventListener('resize', maat);
      }
      for (let i = 0; i < aantal && deeltjes.length < 600; i++) {
        const hoek = ((richting + (Math.random() - 0.5) * spreiding * 2) * Math.PI) / 180;
        const v = kracht * (0.45 + Math.random() * 0.75);
        deeltjes.push({
          x: x * innerWidth,
          y: y * innerHeight,
          vx: Math.cos(hoek) * v,
          vy: Math.sin(hoek) * v,
          hoek: Math.random() * Math.PI,
          draai: (Math.random() - 0.5) * 0.35,
          w: 6 + Math.random() * 6,
          h: 4 + Math.random() * 5,
          kleur: kleuren[Math.floor(Math.random() * kleuren.length)],
          rond: Math.random() < 0.25,
          leven: 0,
          max: 150 + Math.random() * 90,
        });
      }
      if (!loopt) {
        loopt = true;
        requestAnimationFrame(stap);
      }
    }

    function stap() {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      deeltjes = deeltjes.filter((d) => d.leven < d.max && d.y < innerHeight + 30);
      for (const d of deeltjes) {
        d.leven += 1;
        d.vx *= 0.985;
        d.vy = d.vy * 0.985 + 0.24;
        d.x += d.vx + Math.sin(d.leven / 12) * 0.4;
        d.y += d.vy;
        d.hoek += d.draai;
        ctx.save();
        ctx.globalAlpha = Math.min(1, (d.max - d.leven) / 30);
        ctx.translate(d.x, d.y);
        ctx.rotate(d.hoek);
        ctx.fillStyle = d.kleur;
        if (d.rond) {
          ctx.beginPath();
          ctx.arc(0, 0, d.h / 2 + 1, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-d.w / 2, (-d.h / 2) * Math.abs(Math.cos(d.leven / 8)), d.w, d.h * Math.abs(Math.cos(d.leven / 8)) + 1);
        }
        ctx.restore();
      }
      if (deeltjes.length) requestAnimationFrame(stap);
      else {
        loopt = false;
        ctx.clearRect(0, 0, innerWidth, innerHeight);
      }
    }

    // Kleine knal vanaf een knop (bij insturen of stemmen).
    function vanaf(el, aantal = 45) {
      if (!el || !el.getBoundingClientRect) return stoot({ aantal });
      const r = el.getBoundingClientRect();
      stoot({ aantal, x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height / 2) / innerHeight, kracht: 10 });
    }

    function regen(ms = 2500) {
      if (rustig) return;
      const eind = Date.now() + ms;
      (function tik() {
        stoot({ aantal: 5, x: Math.random(), y: -0.03, richting: 90, spreiding: 25, kracht: 3 });
        if (Date.now() < eind) setTimeout(tik, 90);
      })();
    }

    function feest(ms = 3500) {
      stoot({ aantal: 110, x: 0.1, y: 0.75, richting: -65, spreiding: 25, kracht: 17 });
      stoot({ aantal: 110, x: 0.9, y: 0.75, richting: -115, spreiding: 25, kracht: 17 });
      regen(ms);
    }

    return { stoot, vanaf, regen, feest };
  })();

  // Voorkomt dat confetti/meldingen opnieuw afgaan na verversen.
  function eenmalig(sleutel) {
    try {
      const gezien = JSON.parse(sessionStorage.getItem('feestspel-gezien') || '[]');
      if (gezien.includes(sleutel)) return false;
      gezien.push(sleutel);
      sessionStorage.setItem('feestspel-gezien', JSON.stringify(gezien.slice(-30)));
    } catch {
      /* zonder opslag: gewoon tonen */
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Socket-gebeurtenissen
  // ---------------------------------------------------------------------------
  socket.on('connect', () => {
    if (ooitVerbonden) verbindingStatus('Weer verbonden', true);
    setTimeout(() => socket.connected && verbindingStatus(null), 1200);
    ooitVerbonden = true;
    if (sessie) hervat(sessie);
    else if (!huidigeSleutel || huidigeSleutel === 'laden') startScherm();
  });

  socket.on('disconnect', () => {
    verbindingStatus('Verbinding verbroken – opnieuw verbinden…');
  });

  socket.on('connect_error', () => {
    verbindingStatus('Geen verbinding met de server – we blijven het proberen…');
    if (!huidigeSleutel || huidigeSleutel === 'laden') startScherm();
  });

  socket.on('state', (v) => {
    klokVerschil = v.serverNow - Date.now();
    view = v;
    render();
  });

  socket.on('session-ended', ({ message }) => {
    opslag.wis();
    sessie = null;
    bewaardeSessie = null;
    view = null;
    startScherm();
    melding(message || 'Je sessie is beëindigd.', 'fout');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !socket.connected) socket.connect();
  });

  async function hervat(s) {
    const res = await verzend('resume', { code: s.code, token: s.token });
    if (res.ok) {
      sessie = { ...s, role: res.role, name: res.name };
      bewaardeSessie = null;
      opslag.schrijf(sessie);
    } else if (res.error && !/verbinding|reageert/i.test(res.error)) {
      opslag.wis();
      sessie = null;
      bewaardeSessie = null;
      view = null;
      startScherm();
      melding(res.error, 'fout');
    }
  }

  // ---------------------------------------------------------------------------
  // Weergave-motor: een scherm wordt alleen opnieuw opgebouwd als de sleutel
  // verandert. Anders worden alleen de 'live' regio's bijgewerkt, zodat een
  // geopend tekstveld (en het schermtoetsenbord) niet verdwijnt.
  // ---------------------------------------------------------------------------
  function live(fn, tag = 'div', props = {}) {
    const regio = { el: h(tag, props), fn };
    regios.push(regio);
    vul(regio);
    return regio.el;
  }

  function vul(regio) {
    regio.el.replaceChildren(...nodes(regio.fn(view)));
  }

  function toon(sleutel, bouw, breed = false) {
    if (sleutel === huidigeSleutel) {
      regios.forEach(vul);
      tikker();
      return;
    }
    const nieuweVraag = !huidigeSleutel || huidigeSleutel.split('|')[1] !== sleutel.split('|')[1];
    huidigeSleutel = sleutel;
    regios = [];
    lokaal = {};
    app.classList.toggle('breed', breed);
    app.replaceChildren(bouw());
    if (nieuweVraag) window.scrollTo({ top: 0 });
    tikker();
  }

  function render() {
    if (!view) return;
    if (view.role === 'host') hostScherm(view);
    else spelerScherm(view);
  }

  // ---------------------------------------------------------------------------
  // Gedeelde onderdelen
  // ---------------------------------------------------------------------------
  const itemWoord = (v) => (v.roundType === 'stellingen' ? 'Stelling' : 'Vraag');

  // Banner in Psych-stijl: categorie, voortgang en de vraag zelf.
  function banner(label, tekst, sub, groot = false) {
    return h(
      'header',
      { class: `banner ${groot ? 'groot' : ''} ${tekst && tekst.length > 110 ? 'lang' : ''}` },
      h('p', { class: 'banner-label' }, label),
      tekst ? h('p', { class: 'banner-tekst' }, tekst) : null,
      sub ? h('p', { class: 'banner-sub' }, sub) : null
    );
  }

  function kop(v) {
    if (v.phase === 'intro') return banner(`Ronde ${v.round} van ${v.totalRounds}`, v.roundTitle, null, true);
    return [
      banner(v.roundTitle, v.question, `Ronde ${v.round} · ${itemWoord(v)} ${v.qIndex} van ${v.totalQ}`, v.roundType === 'stellingen'),
      // groot tijdens het antwoorden, daarna als miniaturen
      fotos(v.questionImages, v.phase !== 'answer'),
    ];
  }

  // Foto's bij een vraag; tik om te vergroten.
  function fotos(lijst, klein = false) {
    if (!lijst || !lijst.length) return null;
    return h(
      'div',
      { class: `fotos aantal-${Math.min(lijst.length, 3)} ${klein ? 'klein' : ''}` },
      lijst.map((naam, i) =>
        h(
          'button',
          { class: 'foto', type: 'button', 'aria-label': 'Foto vergroten', style: `--draai:${i % 2 ? 2.5 : -2.5}deg`, onclick: () => vergroot(`/fotos/${naam}`) },
          h('img', {
            src: `/fotos/${encodeURIComponent(naam)}`,
            alt: 'Foto bij de vraag',
            loading: 'eager',
            decoding: 'async',
            onerror: (e) => e.currentTarget.closest('.foto').remove(),
          })
        )
      )
    );
  }

  function vergroot(src) {
    const laag = h(
      'div',
      { class: 'fotolaag', role: 'dialog', 'aria-label': 'Foto', onclick: () => laag.remove() },
      h('img', { src, alt: 'Foto bij de vraag' }),
      h('span', { class: 'sluit' }, 'Tik om te sluiten')
    );
    document.body.append(laag);
  }

  function sectie(tekst) {
    return h('p', { class: 'sectie' }, tekst);
  }

  function avatar(naam) {
    let x = 0;
    for (const c of naam) x = (x * 31 + c.codePointAt(0)) >>> 0;
    const letter = ([...naam.trim()][0] || '?').toLocaleUpperCase('nl-NL');
    return h('span', { class: 'avatar', style: `--hue:${x % 360}`, 'aria-hidden': 'true' }, letter);
  }

  function wachten(tekst) {
    return h('p', { class: 'wachten' }, tekst);
  }

  function gesorteerd(spelers) {
    return [...spelers].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'nl'));
  }

  function tussenstand(v, titel = 'Tussenstand') {
    const spelers = gesorteerd(v.players);
    let plek = 0;
    let vorige = null;
    const erbijIemand = v.awarded && Object.values(v.awarded).some(Boolean);
    return h(
      'div',
      { class: 'kaart scores' },
      h('div', { class: 'scores-kop' }, titel),
      erbijIemand ? h('p', { class: 'scores-sub' }, 'Punten erbij!') : null,
      h(
        'ol',
        { class: 'scorelijst' },
        spelers.map((p, i) => {
          if (p.total !== vorige) {
            plek = i + 1;
            vorige = p.total;
          }
          const erbij = v.awarded && v.awarded[p.id];
          const ik = v.me && p.id === v.me.id;
          return h(
            'li',
            { class: `score-rij ${ik ? 'ik' : ''}`, style: `animation-delay:${Math.min(i, 12) * 40}ms` },
            h('span', { class: 'plek' }, plek),
            avatar(p.name),
            h('span', { class: 'naam' }, p.name, ik ? ' (jij)' : ''),
            erbij ? h('span', { class: 'erbij' }, `+${erbij}`) : null,
            h('span', { class: 'totaal' }, p.total)
          );
        })
      )
    );
  }

  function statusChips(v, soort) {
    const relevant = soort === 'vote' ? v.players.filter((p) => p.canVote) : v.players;
    const klaar = relevant.filter((p) => (soort === 'vote' ? p.voted : p.answered)).length;
    const woord = soort === 'vote' ? 'gestemd' : 'ingestuurd';
    return [
      h('p', { class: 'zacht', style: 'font-weight:700;margin-bottom:8px' }, `${klaar} van ${relevant.length} ${woord}`),
      h(
        'ul',
        { class: 'spelers' },
        relevant.map((p) => {
          const isKlaar = soort === 'vote' ? p.voted : p.answered;
          return h(
            'li',
            {
              class: `chip ${isKlaar ? 'klaar' : ''} ${v.me && p.id === v.me.id ? 'ik' : ''} ${p.connected ? '' : 'uit'}`,
              title: p.connected ? '' : 'Niet verbonden',
            },
            isKlaar ? '✓ ' : '… ',
            p.name
          );
        })
      ),
    ];
  }

  function aftelBlok(v) {
    return h(
      'div',
      { class: 'kaart compact', style: 'background:transparent;box-shadow:none;padding:0' },
      h('div', { class: 'aftellen', dataset: { deadline: v.deadline } }, ''),
      h('div', { class: 'tijdbalk', style: 'margin-top:8px' }, h('div', { dataset: { balk: v.deadline } }))
    );
  }

  // Countdown op basis van de serverklok.
  function tikker() {
    const nu = Date.now() + klokVerschil;
    for (const el of app.querySelectorAll('[data-deadline]')) {
      const rest = Math.max(0, Number(el.dataset.deadline) - nu);
      const sec = Math.ceil(rest / 1000);
      el.textContent = rest > 0 ? `${sec}` : 'Tijd is om!';
      el.classList.toggle('bijna', rest > 0 && sec <= 5);
    }
    for (const el of app.querySelectorAll('[data-balk]')) {
      const rest = Math.max(0, Number(el.dataset.balk) - nu);
      const totaal = ((view && view.answerSeconds) || 30) * 1000;
      el.style.width = `${Math.min(100, (rest / totaal) * 100)}%`;
    }
    if (lokaal.bijTijdOp && view && view.deadline && nu >= view.deadline) {
      const fn = lokaal.bijTijdOp;
      lokaal.bijTijdOp = null;
      fn();
    }
  }
  setInterval(tikker, 200);

  // ---------------------------------------------------------------------------
  // Start, aanmaken en deelnemen
  // ---------------------------------------------------------------------------
  function startScherm(fout) {
    const params = new URLSearchParams(location.search);
    if (params.get('code') && !codeUitLinkGebruikt) {
      codeUitLinkGebruikt = true;
      return deelnemenScherm(params.get('code'));
    }
    huidigeSleutel = 'start';
    regios = [];
    app.classList.remove('breed');
    const s = bewaardeSessie;
    app.replaceChildren(
      h(
        'section',
        { class: 'scherm' },
        h('div', { class: 'logo' }, banner('Het feestspel', 'Leinad Nahad', 'Voor maximaal 16 spelers', true)),
        fout ? h('p', { class: 'fout' }, fout) : null,
        s
          ? h(
              'div',
              { class: 'kaart knoppen' },
              h('p', {}, s.role === 'host' ? `Je was host van spel ${s.code}.` : `Je speelde mee in spel ${s.code} als ${s.name || 'speler'}.`),
              h(
                'button',
                {
                  class: 'knop roze',
                  onclick: (e) => {
                    e.currentTarget.disabled = true;
                    sessie = s;
                    hervat(s);
                  },
                },
                'Terug naar het spel'
              )
            )
          : null,
        h(
          'div',
          { class: 'knoppen' },
          h('button', { class: 'knop', onclick: () => deelnemenScherm('') }, 'Deelnemen'),
          h('button', { class: 'knop tweede', onclick: (e) => maakSpel(e.currentTarget) }, 'Spel aanmaken')
        ),
        h('p', { class: 'zacht midden', style: 'font-size:.9rem' }, 'Spel aanmaken is voor de host (spelleider). De host speelt zelf niet mee.')
      )
    );
  }

  async function maakSpel(knop) {
    knop.disabled = true;
    knop.textContent = 'Spel wordt aangemaakt…';
    const res = await verzend('create', {});
    if (!res.ok) {
      melding(res.error, 'fout');
      knop.disabled = false;
      knop.textContent = 'Spel aanmaken';
      return;
    }
    sessie = { code: res.code, token: res.token, role: 'host' };
    opslag.schrijf(sessie);
  }

  function deelnemenScherm(code) {
    huidigeSleutel = 'deelnemen';
    regios = [];
    app.classList.remove('breed');
    const foutVak = h('p', { class: 'fout', hidden: true });
    const codeVeld = h('input', {
      class: 'invoer code',
      id: 'code',
      name: 'code',
      inputmode: 'text',
      autocomplete: 'off',
      autocapitalize: 'characters',
      spellcheck: 'false',
      maxlength: '4',
      placeholder: 'ABCD',
      value: (code || '').toUpperCase().slice(0, 4),
      oninput: (e) => {
        e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
      },
    });
    const naamVeld = h('input', {
      class: 'invoer',
      id: 'naam',
      name: 'naam',
      autocomplete: 'nickname',
      maxlength: '20',
      placeholder: 'Bijv. Sanne',
      enterkeyhint: 'go',
    });
    const knop = h('button', { class: 'knop', type: 'submit' }, 'Deelnemen');
    const form = h(
      'form',
      {
        class: 'kaart knoppen kader',
        onsubmit: async (e) => {
          e.preventDefault();
          foutVak.hidden = true;
          const c = codeVeld.value.trim();
          const n = naamVeld.value.trim();
          if (c.length !== 4) return toonFout('Vul de spelcode van 4 letters in.');
          if (!n) return toonFout('Vul je naam in.');
          knop.disabled = true;
          knop.textContent = 'Bezig…';
          const res = await verzend('join', { code: c, name: n });
          if (!res.ok) {
            knop.disabled = false;
            knop.textContent = 'Deelnemen';
            return toonFout(res.error);
          }
          sessie = { code: res.code, token: res.token, role: 'player', name: res.name };
          opslag.schrijf(sessie);
          history.replaceState(null, '', '/');
        },
      },
      h('div', { class: 'veld' }, h('label', { for: 'code' }, 'Spelcode'), codeVeld),
      h('div', { class: 'veld' }, h('label', { for: 'naam' }, 'Je naam'), naamVeld),
      foutVak,
      knop
    );
    function toonFout(t) {
      foutVak.textContent = t;
      foutVak.hidden = false;
    }
    app.replaceChildren(
      h(
        'section',
        { class: 'scherm' },
        banner('Doe mee', 'Deelnemen', 'Vul de spelcode en je naam in'),
        form,
        h('button', { class: 'link', onclick: () => { history.replaceState(null, '', '/'); startScherm(); } }, '← Terug')
      )
    );
    (codeVeld.value.length === 4 ? naamVeld : codeVeld).focus();
  }

  // ---------------------------------------------------------------------------
  // Spelerschermen
  // ---------------------------------------------------------------------------
  function spelerScherm(v) {
    const p = v.phase;
    const basis = `s|${v.step}|${p}`;
    if (p === 'lobby') return toon(basis, () => spelerWachtkamer(v));
    if (p === 'intro') return toon(basis, () => introScherm(v, false));
    if (p === 'answer') return toon(`${basis}|${v.myAnswer !== null}`, () => spelerAntwoord(v));
    if (p === 'vote') return toon(`${basis}|${v.myVote !== null}`, () => spelerStem(v));
    if (p === 'review') return toon(basis, () => spelerBeoordeling(v));
    if (p === 'statement') return toon(basis, () => spelerStelling(v));
    if (p === 'result') return toon(basis, () => spelerUitslag(v));
    if (p === 'final') return toon(basis, () => eindScherm(v, false));
  }

  function spelerWachtkamer(v) {
    return h(
      'section',
      { class: 'scherm' },
      banner('Wachtkamer', v.code, null, true),
      h('div', { class: 'kaart kader midden' }, h('p', {}, 'Je doet mee als'), h('p', { class: 'ik-naam' }, avatar(v.me.name), v.me.name)),
      live((v) => [
        sectie(`Deelnemers (${v.players.length}/${v.maxPlayers})`),
        h(
          'ul',
          { class: 'spelers' },
          v.players.map((p) =>
            h(
              'li',
              { class: `chip ${p.id === v.me.id ? 'ik' : ''} ${p.connected ? '' : 'uit'}` },
              h('span', { class: `stip ${p.connected ? '' : 'weg'}` }),
              p.name
            )
          )
        ),
      ]),
      live((v) => wachten(v.hostConnected ? 'Wachten tot de host het spel start…' : 'Wachten op de host… (host is even niet verbonden)')),
      h(
        'button',
        {
          class: 'link',
          onclick: async (e) => {
            if (!confirm('Weet je zeker dat je het spel wilt verlaten?')) return;
            const res = await actie(e.currentTarget, 'leave');
            if (res.ok) {
              opslag.wis();
              sessie = null;
              view = null;
              startScherm();
            }
          },
        },
        'Spel verlaten'
      )
    );
  }

  function introScherm(v, isHost) {
    return h(
      'section',
      { class: 'scherm' },
      kop(v),
      h('div', { class: 'kaart kader' }, h('p', { class: 'uitleg' }, v.roundUitleg)),
      isHost
        ? h('button', { class: 'knop', onclick: (e) => actie(e.currentTarget, 'next', {}, 'Bezig…') }, `Start ronde ${v.round}`)
        : wachten('De host start zo de ronde…'),
      v.round > 1 ? live((v) => tussenstand(v)) : null
    );
  }

  function spelerAntwoord(v) {
    const kennis = v.roundType === 'kennis';
    const deel = [kop(v)];
    if (kennis) deel.push(aftelBlok(v));

    if (v.myAnswer !== null) {
      deel.push(
        h(
          'div',
          { class: 'kaart' },
          h('div', { class: 'bevestigd' }, h('span', { class: 'vink' }, '✓'), h('span', {}, 'Je antwoord is verstuurd')),
          h('p', { style: 'margin-top:10px' }, '“', v.myAnswer, '”')
        ),
        wachten(kennis ? 'Wachten tot iedereen klaar is of de tijd om is…' : 'Wachten op de andere spelers…')
      );
    } else {
      const foutVak = h('p', { class: 'fout', hidden: true });
      const teller = h('p', { class: 'teller' }, `0/${v.answerMax}`);
      const veld = h('textarea', {
        class: 'invoer',
        id: 'antwoord',
        maxlength: String(v.answerMax),
        placeholder: 'Typ je antwoord…',
        rows: 3,
        enterkeyhint: 'send',
        oninput: () => {
          teller.textContent = `${veld.value.length}/${v.answerMax}`;
          foutVak.hidden = true;
        },
        onfocus: () => setTimeout(() => form.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300),
        onkeydown: (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            form.requestSubmit();
          }
        },
      });
      const knop = h('button', { class: 'knop', type: 'submit' }, 'Insturen');
      const form = h(
        'form',
        {
          class: 'kaart knoppen kader',
          onsubmit: async (e) => {
            e.preventDefault();
            const tekst = veld.value.trim();
            if (!tekst) {
              foutVak.textContent = 'Een leeg antwoord kan niet worden ingestuurd.';
              foutVak.hidden = false;
              return;
            }
            veld.blur();
            const res = await actie(knop, 'answer', { text: tekst }, 'Versturen…', { stil: true });
            if (res.ok) confetti.vanaf(knop, 40);
            else if (res.error) {
              // Fout direct bij het tekstveld tonen (bijv. dubbel antwoord); tekst blijft staan.
              foutVak.textContent = res.error;
              foutVak.hidden = false;
              if (veld.isConnected && !veld.disabled) veld.focus();
            }
          },
        },
        h('label', { for: 'antwoord', class: 'sectie' }, 'Jouw antwoord'),
        veld,
        teller,
        foutVak,
        knop
      );
      if (kennis) {
        lokaal.bijTijdOp = () => {
          knop.disabled = true;
          veld.disabled = true;
          knop.textContent = 'De tijd is om';
        };
      }
      deel.push(form);
    }
    deel.push(live((v) => statusChips(v, 'answer'), 'div', { class: 'kaart' }));
    return h('section', { class: 'scherm' }, deel);
  }

  function spelerStem(v) {
    const gestemd = v.myVote !== null;
    lokaal.keuze = v.myVote;
    const stemKnop = h('button', { class: 'knop roze', disabled: true }, 'Stem uitbrengen');
    const optieKnoppen = v.options.map((o) => {
      const knop = h(
        'button',
        {
          class: `optie ${o.mine ? 'eigen' : ''} ${o.id === v.myVote ? 'gekozen' : ''}`,
          disabled: o.mine || gestemd,
          'aria-pressed': String(o.id === v.myVote),
          onclick: () => {
            lokaal.keuze = o.id;
            for (const k of optieKnoppen) {
              const aan = k.dataset.id === o.id;
              k.classList.toggle('gekozen', aan);
              k.setAttribute('aria-pressed', String(aan));
            }
            stemKnop.disabled = false;
          },
          dataset: { id: o.id },
        },
        o.mine ? h('span', { class: 'label' }, 'Jouw antwoord') : null,
        o.id === v.myVote ? h('span', { class: 'label' }, 'Jouw stem ✓') : null,
        h('span', { class: 'optie-tekst' }, '“', o.text, '”')
      );
      return knop;
    });
    stemKnop.addEventListener('click', () => {
      if (lokaal.keuze)
        actie(stemKnop, 'vote', { optionId: lokaal.keuze }, 'Stem wordt verstuurd…').then((res) => res.ok && confetti.vanaf(stemKnop, 40));
    });

    const deel = [kop(v)];
    if (!v.options.length) {
      deel.push(h('div', { class: 'kaart' }, h('p', {}, 'Er zijn geen antwoorden ingestuurd.')), wachten('Wachten op de host…'));
    } else {
      deel.push(sectie(gestemd ? 'Je stem is uitgebracht!' : 'Kies je favoriete antwoord'));
      if (!v.canVote) deel.push(h('div', { class: 'kaart compact' }, h('p', {}, 'Er is geen antwoord waarop jij kunt stemmen.')));
      deel.push(h('div', { class: 'opties' }, optieKnoppen));
      if (gestemd || !v.canVote) deel.push(wachten('Wachten tot iedereen heeft gestemd…'));
      else deel.push(h('div', { class: 'vastbalk' }, stemKnop));
    }
    deel.push(live((v) => statusChips(v, 'vote'), 'div', { class: 'kaart' }));
    return h('section', { class: 'scherm' }, deel);
  }

  function antwoordenLijst(v, metBeoordeling) {
    return h(
      'ul',
      { class: 'lijst' },
      v.answers.map((a) =>
        h(
          'li',
          { class: `uitslag-item ${v.me && a.playerId === v.me.id ? 'ik' : ''}` },
          h(
            'div',
            { class: 'boven' },
            h('span', { class: 'auteur' }, avatar(a.name), a.name),
            metBeoordeling ? h('span', { class: `badge ${a.approved ? '' : 'nul'}` }, a.approved ? '✓ +3' : '0') : null
          ),
          a.text === null ? h('span', { class: 'tekst geen-antwoord' }, 'Geen antwoord') : h('span', { class: 'tekst' }, a.text)
        )
      )
    );
  }

  function spelerBeoordeling(v) {
    return h(
      'section',
      { class: 'scherm' },
      kop(v),
      h('div', { class: 'kaart' }, sectie('Alle antwoorden'), antwoordenLijst(v, false)),
      wachten('De host beoordeelt de antwoorden…')
    );
  }

  function spelerStelling(v) {
    return h(
      'section',
      { class: 'scherm' },
      kop(v),
      wachten('Speel de stelling samen. De host deelt daarna de punten uit.')
    );
  }

  function uitslagInhoud(v) {
    if (v.roundType === 'psych') {
      if (!v.results.length) return h('div', { class: 'kaart' }, h('p', {}, 'Er zijn geen antwoorden ingestuurd, dus er zijn geen punten verdeeld.'));
      return h(
        'div',
        { class: 'kaart' },
        sectie('Uitslag'),
        h(
          'ul',
          { class: 'lijst' },
          v.results.map((r, i) =>
            h(
              'li',
              { class: `uitslag-item ${r.mine ? 'ik' : ''}`, style: `animation-delay:${i * 60}ms` },
              h(
                'div',
                { class: 'boven' },
                h('span', { class: 'tekst' }, '“', r.text, '”'),
                h('span', { class: `badge ${r.votes ? '' : 'nul'}` }, `${r.votes} ${r.votes === 1 ? 'stem' : 'stemmen'}`)
              ),
              h('span', { class: 'auteur' }, avatar(r.authorName), r.authorName, r.mine ? ' (jij)' : '', r.votes ? ` · +${r.votes} pt` : '')
            )
          )
        )
      );
    }
    if (v.roundType === 'kennis') {
      return h('div', { class: 'kaart' }, sectie('Beoordeling'), antwoordenLijst(v, true));
    }
    const winnaars = v.players.filter((p) => v.awarded && v.awarded[p.id]);
    return h(
      'div',
      { class: 'kaart' },
      sectie('Punten voor deze stelling'),
      winnaars.length
        ? h(
            'ul',
            { class: 'lijst' },
            winnaars.map((p) =>
              h('li', { class: 'rij' }, avatar(p.name), h('span', { class: 'naam' }, p.name, v.me && p.id === v.me.id ? ' (jij)' : ''), h('span', { class: 'badge' }, `+${v.awarded[p.id]}`))
            )
          )
        : h('p', {}, 'Niemand heeft punten gekregen bij deze stelling.')
    );
  }

  function spelerUitslag(v) {
    const mijnPunten = v.awarded && v.awarded[v.me.id];
    if (mijnPunten && eenmalig(`punten:${v.code}:${v.gameNumber}:${v.step}`)) {
      setTimeout(() => {
        melding(`🎉 Je kreeg +${mijnPunten} ${mijnPunten === 1 ? 'punt' : 'punten'}!`, 'goed');
        confetti.stoot({ aantal: Math.min(160, 50 + mijnPunten * 20), y: 0.35 });
      }, 250);
    }
    return h(
      'section',
      { class: 'scherm' },
      kop(v),
      uitslagInhoud(v),
      live((v) => tussenstand(v)),
      wachten('Wachten op de host…')
    );
  }

  function eindScherm(v, isHost) {
    const winnaars = v.ranking.filter((r) => r.winner);
    if (eenmalig(`einde:${v.code}:${v.gameNumber}`)) {
      const ikWin = v.me && winnaars.some((w) => w.id === v.me.id);
      setTimeout(() => confetti.feest(ikWin ? 6000 : 3500), 300);
    }
    return h(
      'section',
      { class: 'scherm' },
      banner('Einde van het spel', 'Einduitslag', null, true),
      winnaars.length
        ? h(
            'div',
            { class: 'winnaar' },
            h('span', { class: 'beker', 'aria-hidden': 'true' }, '🏆'),
            h('p', { style: 'font-weight:800' }, winnaars.length > 1 ? 'De winnaars zijn' : 'De winnaar is'),
            h('p', { class: 'namen' }, winnaars.map((w) => w.name).join(' & ')),
            h('p', { style: 'font-weight:800' }, `met ${winnaars[0].total} punten`)
          )
        : null,
      h(
        'div',
        { class: 'kaart rangschikking' },
        h(
          'ol',
          { class: 'lijst' },
          v.ranking.map((r) =>
            h(
              'li',
              { class: `rij ${r.winner ? 'winnaar-rij' : ''}` },
              h('span', { class: 'plek' }, r.winner ? '🏆' : `${r.rank}.`),
              avatar(r.name),
              h('span', { class: 'naam' }, r.name, v.me && r.id === v.me.id ? ' (jij)' : ''),
              h('span', { class: 'punten' }, `${r.total} pt`),
              h(
                'div',
                { class: 'per-ronde' },
                r.scores.map((s, i) => h('span', {}, `${v.roundTitles[i]}: ${s}`))
              )
            )
          )
        )
      ),
      isHost
        ? h(
            'button',
            {
              class: 'knop',
              onclick: (e) => {
                if (confirm('Nieuw spel starten met dezelfde spelers? Alle scores gaan terug naar nul.')) actie(e.currentTarget, 'newGame', {}, 'Bezig…');
              },
            },
            'Nieuw spel met dezelfde spelers'
          )
        : wachten('Bedankt voor het spelen! De host kan een nieuw spel starten.')
    );
  }

  // ---------------------------------------------------------------------------
  // Hostschermen
  // ---------------------------------------------------------------------------
  function hostScherm(v) {
    toon(`h|${v.step}|${v.phase}`, () => hostIndeling(v, hostHoofd(v)), true);
  }

  function hostIndeling(v, hoofd) {
    return h(
      'div',
      { class: 'scherm' },
      h(
        'div',
        { class: 'kop' },
        h('h2', {}, 'Hostscherm'),
        h('span', { class: 'code-klein', title: 'Spelcode' }, v.code)
      ),
      h('div', { class: 'host-raster' }, h('div', { class: 'scherm' }, hoofd), h('aside', { class: 'host-zijbalk' }, live(hostZijbalk)))
    );
  }

  function hostZijbalk(v) {
    const status = (p) => {
      if (v.phase === 'answer') return p.answered ? '✓ ingestuurd' : 'nog bezig';
      if (v.phase === 'vote') return !p.canVote ? 'kan niet stemmen' : p.voted ? '✓ gestemd' : 'nog niet gestemd';
      return '';
    };
    const lijst = v.phase === 'lobby' ? v.players : gesorteerd(v.players);
    return h(
      'div',
      { class: 'kaart' },
      sectie(`Deelnemers (${v.players.length}/${v.maxPlayers})`),
      lijst.length
        ? h(
            'ul',
            { class: 'lijst' },
            lijst.map((p) =>
              h(
                'li',
                { class: 'rij' },
                h('span', { class: `stip`, style: `width:10px;height:10px;border-radius:50%;flex:none;background:var(${p.connected ? '--goed' : '--fout'})`, title: p.connected ? 'Verbonden' : 'Niet verbonden' }),
                h(
                  'span',
                  { class: 'naam' },
                  p.name,
                  h('span', { class: 'zacht', style: 'display:block;font-size:.8rem;font-weight:600' }, [p.connected ? 'verbonden' : 'niet verbonden', status(p)].filter(Boolean).join(' · '))
                ),
                v.phase !== 'lobby' ? h('span', { class: 'punten' }, `${p.total} pt`) : null,
                v.phase === 'lobby'
                  ? h(
                      'button',
                      {
                        class: 'knop tweede klein',
                        'aria-label': `Verwijder ${p.name}`,
                        onclick: (e) => {
                          if (confirm(`${p.name} uit het spel verwijderen?`)) actie(e.currentTarget, 'kick', { playerId: p.id });
                        },
                      },
                      'Verwijderen'
                    )
                  : null
              )
            )
          )
        : h('p', { class: 'zacht' }, 'Nog geen spelers. Deel de spelcode!')
    );
  }

  function volgendeLabel(v) {
    if (!v.isLastQuestion) return v.roundType === 'stellingen' ? 'Volgende stelling' : 'Volgende vraag';
    if (!v.isLastRound) return `Door naar ronde ${v.round + 1}`;
    return 'Einduitslag openen';
  }

  function hostHoofd(v) {
    const p = v.phase;
    if (p === 'lobby') {
      const url = `${location.origin}/?code=${v.code}`;
      return [
        h(
          'div',
          { class: 'kaart knoppen midden' },
          h('p', { style: 'font-weight:700' }, 'Spelcode'),
          h('div', { class: 'spelcode' }, v.code),
          h('p', {}, 'Spelers gaan naar ', h('strong', {}, location.host), ' en vullen deze code in, of scannen de QR-code.'),
          h('img', { class: 'qr', src: `/qr/${v.code}.svg`, alt: `QR-code naar ${url}`, width: 180, height: 180 })
        ),
        live((v) =>
          h(
            'button',
            {
              class: 'knop',
              disabled: v.players.length < v.minPlayers,
              onclick: (e) => {
                const offline = v.players.filter((p) => !p.connected).length;
                if (offline && !confirm(`${offline} speler(s) zijn niet verbonden. Toch starten?`)) return;
                actie(e.currentTarget, 'start', {}, 'Bezig…');
              },
            },
            v.players.length ? `Spel starten (${v.players.length} ${v.players.length === 1 ? 'speler' : 'spelers'})` : 'Wachten op spelers…'
          )
        ),
        h('p', { class: 'zacht midden', style: 'font-size:.9rem' }, 'Na de start kunnen geen nieuwe spelers meer aansluiten.'),
      ];
    }
    if (p === 'intro') return introScherm(v, true);
    if (p === 'final') return eindScherm(v, true);

    const deel = [kop(v)];

    if (p === 'answer') {
      if (v.roundType === 'kennis') deel.push(aftelBlok(v));
      deel.push(live((v) => statusChips(v, 'answer'), 'div', { class: 'kaart' }));
      if (v.roundType === 'psych') {
        deel.push(
          h(
            'button',
            {
              class: 'knop',
              onclick: (e) => {
                const n = view.players.filter((x) => x.answered).length;
                if (!confirm(`Antwoordfase afsluiten? Alleen de ${n} ingestuurde antwoorden doen mee.`)) return;
                actie(e.currentTarget, 'closeAnswers', {}, 'Bezig…');
              },
            },
            'Antwoordfase afsluiten'
          )
        );
      } else {
        deel.push(wachten('De antwoordfase sluit automatisch als iedereen heeft ingestuurd of de tijd om is.'));
      }
    }

    if (p === 'vote') {
      deel.push(live((v) => statusChips(v, 'vote'), 'div', { class: 'kaart' }));
      deel.push(
        h(
          'div',
          { class: 'kaart' },
          sectie(`Antwoorden (${v.options.length}) — anoniem`),
          v.options.length
            ? h('ol', { class: 'opties twee-kolommen', style: 'padding:0;list-style:none' }, v.options.map((o) => h('li', { class: 'rij' }, o.text)))
            : h('p', {}, 'Er zijn geen antwoorden ingestuurd.')
        )
      );
      deel.push(
        h(
          'button',
          {
            class: 'knop',
            onclick: (e) => {
              const open = view.players.filter((x) => x.canVote && !x.voted).length;
              if (open && !confirm(`${open} speler(s) hebben nog niet gestemd. Stemfase toch afsluiten?`)) return;
              actie(e.currentTarget, 'closeVotes', {}, 'Bezig…');
            },
          },
          'Stemfase afsluiten'
        )
      );
    }

    if (p === 'review' || p === 'statement') {
      const review = p === 'review';
      lokaal.selectie = new Set(v.selected || []);
      const samenvatting = h('p', { class: 'telling' });
      const werkSamenvattingBij = () => {
        const n = lokaal.selectie.size;
        samenvatting.textContent = `${n} ${n === 1 ? 'speler' : 'spelers'} geselecteerd → ${n * 3} punten totaal`;
      };
      const items = review ? v.answers : v.players.map((x) => ({ playerId: x.id, name: x.name, text: undefined }));
      const keuzes = items.map((a) => {
        const kanNiet = review && a.text === null;
        const knop = h(
          'button',
          {
            class: 'keuze',
            type: 'button',
            disabled: kanNiet,
            'aria-pressed': String(lokaal.selectie.has(a.playerId)),
            onclick: () => {
              if (lokaal.selectie.has(a.playerId)) lokaal.selectie.delete(a.playerId);
              else lokaal.selectie.add(a.playerId);
              knop.setAttribute('aria-pressed', String(lokaal.selectie.has(a.playerId)));
              knop.querySelector('.vakje').textContent = lokaal.selectie.has(a.playerId) ? '✓' : '';
              werkSamenvattingBij();
              // Synchroniseer de concept-selectie (bijv. voor een tweede hostapparaat of verversen).
              verzend('action', { type: 'select', step: view.step, selection: [...lokaal.selectie] });
            },
          },
          h('span', { class: 'vakje' }, lokaal.selectie.has(a.playerId) ? '✓' : ''),
          h(
            'span',
            { class: 'inhoud' },
            h('span', { class: 'naam' }, a.name),
            review ? (a.text === null ? h('span', { class: 'geen-antwoord' }, 'Geen antwoord') : h('span', {}, a.text)) : null
          )
        );
        return knop;
      });
      werkSamenvattingBij();
      deel.push(
        h(
          'div',
          { class: 'kaart knoppen' },
          sectie(review ? 'Vink de goede antwoorden aan · 3 punten per stuk' : 'Wie krijgt er 3 punten?'),
          h('div', { class: 'knoppen', style: 'gap:8px' }, keuzes),
          samenvatting,
          h(
            'button',
            {
              class: 'knop',
              onclick: (e) => {
                const aantal = lokaal.selectie.size;
                if (!aantal && !confirm('Er is niemand geselecteerd. Niemand krijgt punten. Doorgaan?')) return;
                actie(e.currentTarget, 'confirmPoints', { selection: [...lokaal.selectie] }, 'Punten worden toegekend…').then((res) => {
                  if (res.ok) {
                    melding('Punten toegekend!', 'goed');
                    if (aantal) confetti.stoot({ aantal: 60 + aantal * 10 });
                  }
                });
              },
            },
            'Punten bevestigen'
          )
        )
      );
    }

    if (p === 'result') {
      deel.push(uitslagInhoud(v));
      deel.push(h('button', { class: 'knop', onclick: (e) => actie(e.currentTarget, 'next', {}, 'Bezig…') }, volgendeLabel(v)));
    }

    return deel;
  }

  // ---------------------------------------------------------------------------
  // Opstarten
  // ---------------------------------------------------------------------------
  if (!sessie) startScherm();
  else huidigeSleutel = 'laden';
})();
