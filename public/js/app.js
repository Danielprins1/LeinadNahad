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
  let laatsteMelding = (() => {
    try {
      return sessionStorage.getItem('feestspel-melding');
    } catch {
      return null;
    }
  })();

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
  async function actie(knop, type, extra = {}, bezigTekst) {
    if (knop && knop.disabled) return { ok: false };
    const oud = knop ? knop.textContent : '';
    if (knop) {
      knop.disabled = true;
      if (bezigTekst) knop.textContent = bezigTekst;
    }
    const res = await verzend('action', { type, step: view ? view.step : -1, ...extra });
    if (!res.ok) {
      melding(res.error, 'fout');
      if (knop && knop.isConnected) {
        knop.disabled = false;
        knop.textContent = oud;
      }
    }
    return res;
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

  function voortgang(v) {
    if (v.phase === 'intro') return h('div', { class: 'voortgang' }, `Ronde ${v.round} van ${v.totalRounds}`);
    return h(
      'div',
      { class: 'voortgang' },
      h('span', {}, `Ronde ${v.round} — ${itemWoord(v)} ${v.qIndex} van ${v.totalQ}`),
      h('span', {}, v.roundTitle)
    );
  }

  function vraagKaart(v) {
    const klasse = v.roundType === 'stellingen' ? 'stelling' : 'vraag';
    return h('div', { class: 'kaart' }, h('p', { class: klasse }, v.question));
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
    return h(
      'div',
      { class: 'kaart' },
      h('h3', {}, titel),
      h(
        'ol',
        { class: 'lijst', style: 'margin-top:10px' },
        spelers.map((p, i) => {
          if (p.total !== vorige) {
            plek = i + 1;
            vorige = p.total;
          }
          const erbij = v.awarded && v.awarded[p.id];
          return h(
            'li',
            { class: 'rij' },
            h('span', { class: 'plek', style: 'font-weight:900;width:1.6em' }, `${plek}.`),
            h('span', { class: 'naam' }, p.name, v.me && p.id === v.me.id ? ' (jij)' : ''),
            erbij ? h('span', { class: 'badge' }, `+${erbij}`) : null,
            h('span', { class: 'punten' }, `${p.total} pt`)
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
        h(
          'div',
          { class: 'logo' },
          h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🎉'),
          h('h1', {}, 'Leinad Nahad'),
          h('p', { class: 'zacht' }, 'Het feestspel voor maximaal 16 spelers')
        ),
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
        class: 'kaart knoppen',
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
        h('div', { class: 'logo', style: 'padding-top:2vh' }, h('h1', {}, 'Deelnemen')),
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
      h('h1', {}, 'Wachtkamer'),
      h(
        'div',
        { class: 'kaart' },
        h('p', { class: 'zacht' }, 'Spelcode'),
        h('p', { style: 'font-size:2rem;font-weight:900;letter-spacing:.15em' }, v.code),
        h('p', {}, 'Je doet mee als ', h('strong', {}, v.me.name))
      ),
      live((v) => [
        h('h3', { style: 'margin-bottom:10px' }, `Deelnemers (${v.players.length}/${v.maxPlayers})`),
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
      voortgang(v),
      h('h1', {}, `Ronde ${v.round}: ${v.roundTitle}`),
      h('div', { class: 'kaart' }, h('p', {}, v.roundUitleg)),
      isHost
        ? h('button', { class: 'knop', onclick: (e) => actie(e.currentTarget, 'next', {}, 'Bezig…') }, `Start ronde ${v.round}`)
        : wachten('De host start zo de ronde…'),
      v.round > 1 ? live((v) => tussenstand(v)) : null
    );
  }

  function spelerAntwoord(v) {
    const kennis = v.roundType === 'kennis';
    const deel = [voortgang(v), vraagKaart(v)];
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
          class: 'kaart knoppen',
          onsubmit: async (e) => {
            e.preventDefault();
            const tekst = veld.value.trim();
            if (!tekst) {
              foutVak.textContent = 'Een leeg antwoord kan niet worden ingestuurd.';
              foutVak.hidden = false;
              return;
            }
            veld.blur();
            await actie(knop, 'answer', { text: tekst }, 'Versturen…');
          },
        },
        h('label', { for: 'antwoord', style: 'font-weight:700' }, 'Jouw antwoord'),
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
        o.text
      );
      return knop;
    });
    stemKnop.addEventListener('click', () => {
      if (lokaal.keuze) actie(stemKnop, 'vote', { optionId: lokaal.keuze }, 'Stem wordt verstuurd…');
    });

    const deel = [voortgang(v), h('div', { class: 'kaart compact' }, h('p', { style: 'font-weight:700' }, v.question))];
    if (!v.options.length) {
      deel.push(h('div', { class: 'kaart' }, h('p', {}, 'Er zijn geen antwoorden ingestuurd.')), wachten('Wachten op de host…'));
    } else {
      deel.push(h('h2', {}, gestemd ? 'Je stem is uitgebracht!' : 'Stem op je favoriete antwoord'));
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
            h('span', { class: 'auteur' }, a.name),
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
      voortgang(v),
      vraagKaart(v),
      h('div', { class: 'kaart' }, h('h3', { style: 'margin-bottom:10px' }, 'Alle antwoorden'), antwoordenLijst(v, false)),
      wachten('De host beoordeelt de antwoorden…')
    );
  }

  function spelerStelling(v) {
    return h(
      'section',
      { class: 'scherm' },
      voortgang(v),
      vraagKaart(v),
      wachten('Speel de stelling samen. De host deelt daarna de punten uit.')
    );
  }

  function uitslagInhoud(v) {
    if (v.roundType === 'psych') {
      if (!v.results.length) return h('div', { class: 'kaart' }, h('p', {}, 'Er zijn geen antwoorden ingestuurd, dus er zijn geen punten verdeeld.'));
      return h(
        'div',
        { class: 'kaart' },
        h('h3', { style: 'margin-bottom:10px' }, 'Uitslag'),
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
                h('span', { class: 'tekst' }, r.text),
                h('span', { class: `badge ${r.votes ? '' : 'nul'}` }, `${r.votes} ${r.votes === 1 ? 'stem' : 'stemmen'}`)
              ),
              h('span', { class: 'auteur' }, 'van ', r.authorName, r.mine ? ' (jij)' : '', r.votes ? ` · +${r.votes} pt` : '')
            )
          )
        )
      );
    }
    if (v.roundType === 'kennis') {
      return h('div', { class: 'kaart' }, h('h3', { style: 'margin-bottom:10px' }, 'Beoordeling'), antwoordenLijst(v, true));
    }
    const winnaars = v.players.filter((p) => v.awarded && v.awarded[p.id]);
    return h(
      'div',
      { class: 'kaart' },
      h('h3', { style: 'margin-bottom:10px' }, 'Punten voor deze stelling'),
      winnaars.length
        ? h(
            'ul',
            { class: 'lijst' },
            winnaars.map((p) =>
              h('li', { class: 'rij' }, h('span', { class: 'naam' }, p.name, v.me && p.id === v.me.id ? ' (jij)' : ''), h('span', { class: 'badge' }, `+${v.awarded[p.id]}`))
            )
          )
        : h('p', {}, 'Niemand heeft punten gekregen bij deze stelling.')
    );
  }

  function spelerUitslag(v) {
    const mijnPunten = v.awarded && v.awarded[v.me.id];
    const meldSleutel = `${v.code}:${v.gameNumber}:${v.step}`;
    if (mijnPunten && laatsteMelding !== meldSleutel) {
      laatsteMelding = meldSleutel;
      try {
        sessionStorage.setItem('feestspel-melding', meldSleutel);
      } catch {
        /* negeren */
      }
      setTimeout(() => melding(`🎉 Je kreeg +${mijnPunten} ${mijnPunten === 1 ? 'punt' : 'punten'}!`, 'goed'), 150);
    }
    return h(
      'section',
      { class: 'scherm' },
      voortgang(v),
      h('div', { class: 'kaart compact' }, h('p', { style: 'font-weight:700' }, v.question)),
      uitslagInhoud(v),
      live((v) => tussenstand(v)),
      wachten('Wachten op de host…')
    );
  }

  function eindScherm(v, isHost) {
    const winnaars = v.ranking.filter((r) => r.winner);
    return h(
      'section',
      { class: 'scherm' },
      h('h1', { class: 'midden' }, 'Einduitslag'),
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
      h('h3', { style: 'margin-bottom:10px' }, `Deelnemers (${v.players.length}/${v.maxPlayers})`),
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

    const deel = [voortgang(v)];

    if (p === 'answer') {
      deel.push(vraagKaart(v));
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
      deel.push(h('div', { class: 'kaart compact' }, h('p', { style: 'font-weight:700' }, v.question)));
      deel.push(live((v) => statusChips(v, 'vote'), 'div', { class: 'kaart' }));
      deel.push(
        h(
          'div',
          { class: 'kaart' },
          h('h3', { style: 'margin-bottom:10px' }, `Antwoorden (${v.options.length}) — anoniem`),
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
      deel.push(review ? h('div', { class: 'kaart compact' }, h('p', { class: 'vraag' }, v.question)) : vraagKaart(v));
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
          h('h3', {}, review ? 'Vink de goede antwoorden aan (3 punten per goed antwoord)' : 'Wie krijgt er 3 punten?'),
          h('div', { class: 'knoppen', style: 'gap:8px' }, keuzes),
          samenvatting,
          h(
            'button',
            {
              class: 'knop',
              onclick: (e) => {
                if (!lokaal.selectie.size && !confirm('Er is niemand geselecteerd. Niemand krijgt punten. Doorgaan?')) return;
                actie(e.currentTarget, 'confirmPoints', { selection: [...lokaal.selectie] }, 'Punten worden toegekend…').then((res) => {
                  if (res.ok) melding('Punten toegekend!', 'goed');
                });
              },
            },
            'Punten bevestigen'
          )
        )
      );
    }

    if (p === 'result') {
      deel.push(h('div', { class: 'kaart compact' }, h('p', { style: 'font-weight:700' }, v.question)));
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
