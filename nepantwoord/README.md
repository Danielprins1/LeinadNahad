# Nepantwoord – realtime multiplayer partyspel

Spelers verzinnen bij een vraag een geloofwaardig nepantwoord en raden daarna welk antwoord echt is.
1 host, 2 tot 30 spelers, 1 tot 5 vragen. Alles in het Nederlands, zonder accounts.

> "Nepantwoord" is een werktitel (`APP_NAME` in `src/lib/constants.ts`). Het visuele ontwerp is bewust
> neutraal gehouden, zodat het definitieve design er later makkelijk overheen kan.

---

## 1. Technische architectuur

```
 Telefoon / laptop (Next.js-pagina's, React)
   │  ① HTTP (fetch) met geheim sessietoken  ──►  Next.js API-routes (server)
   │                                                 │  service-role-key (alleen server)
   │                                                 ▼
   │                                           Supabase Postgres
   │                                           (tabellen + transactionele SQL-functies)
   │                                                 │
   │  ② Supabase Realtime-broadcast "refresh"  ◄──── server seint na iedere wijziging
   └─ daarna haalt iedere client zijn EIGEN gefilterde status op via ①
```

- **Next.js (App Router) + TypeScript** voor de pagina's én de API-routes.
- **Supabase Postgres** is de enige bron van waarheid. Alle spelregels die moeten kloppen bij gelijktijdige
  verzoeken (fase controleren + opslaan, max. 30 spelers, unieke antwoorden, één stem, punten één keer
  toekennen) zitten in **SQL-functies die in één transactie draaien**, met een rij-lock op het spel.
- **Supabase Realtime (Broadcast)**: na iedere wijziging stuurt de server op kanaal `room:<CODE>` een leeg
  `refresh`-signaal. Het signaal bevat **géén speldata**; iedere client haalt daarna zijn eigen, per rol
  gefilterde status op bij `/api/games/<CODE>/state`. Zo kan er via realtime nooit iets uitlekken.
- **Vangnet**: clients pollen daarnaast elke 8 s (3 s als realtime wegvalt) en verversen direct bij terugkeren
  naar het tabblad of herstel van internet. Dat pollen is ook de hartslag voor de "verbonden"-status.
- **Geen gebruikersaccounts.** Bij aanmaken krijgt de host een willekeurig geheim **hosttoken**, bij meedoen
  krijgt iedere speler een **spelerstoken** (256 bits). In de database staat alleen de SHA-256-hash. Het token
  staat in `localStorage`, zodat verversen of tijdelijk wegvallen je automatisch terugbrengt in hetzelfde spel.
- **De browser kan niets rechtstreeks in de database.** Row Level Security staat aan zonder policies, en alle
  rechten van `anon`/`authenticated` op tabellen en functies zijn ingetrokken. De publieke anon-key wordt
  alleen gebruikt om naar het realtime-kanaal te luisteren.

### Game states

| Status               | Betekenis                                                        | Host-knop → volgende status          |
|----------------------|------------------------------------------------------------------|--------------------------------------|
| `LOBBY`              | Spelers doen mee                                                 | START SPEL → `SUBMITTING_ANSWERS`    |
| `SUBMITTING_ANSWERS` | Vraag tonen + nepantwoord invoeren + wachten op de rest          | DOOR NAAR STEMMEN → `VOTING`         |
| `VOTING`             | Stemmen op het antwoord dat volgens jou echt is                  | ONTHUL ANTWOORDEN → `REVEAL`         |
| `REVEAL`             | Juiste antwoord, bedenkers, stemmers en punten van deze ronde    | TOON TUSSENSTAND → `SCOREBOARD`      |
| `SCOREBOARD`         | Tussenstand                                                      | VOLGENDE VRAAG → `SUBMITTING_ANSWERS` of TOON EINDSTAND → `FINISHED` |
| `FINISHED`           | Eindstand met top 3                                              | OPNIEUW SPELEN → `LOBBY` of TERUG NAAR START → `CLOSED` |
| `CLOSED`             | Spel beëindigd (ook via "Spel beëindigen" tijdens het spel)      | –                                    |

"Vraag tonen" en "nepantwoord invoeren" zijn samen één status (`SUBMITTING_ANSWERS`), omdat de speler de vraag
en het invoerveld op hetzelfde scherm ziet. "Wachten op andere spelers" is geen aparte status: dat ziet een
speler zodra zijn eigen antwoord is opgeslagen. Het spel gaat **nooit** automatisch verder; iedere overgang is
een hostactie, en de SQL-functie controleert de huidige status (een dubbelklik doet dus niets extra's).

### Veiligheid van het juiste antwoord

- Het juiste antwoord wordt bij het aanmaken naar de server gestuurd en daarna **pas in de status `REVEAL`**
  weer uit de database gelezen (`src/lib/server/state.ts`). Ook de host krijgt het vóór de onthulling niet
  terug, omdat het hostscherm vaak voor iedereen zichtbaar is.
- In de stemfase staat het juiste antwoord als gewone optie tussen de nepantwoorden: alleen `id` en `text`,
  zonder auteur en zonder "juist"-markering. Alle opties hebben willekeurige UUID's en een volgorde die bij het
  openen van de stemfase één keer willekeurig wordt bepaald (zelfde volgorde voor iedereen).
- De controle "is dit het juiste antwoord?" en "bestaat dit antwoord al?" gebeurt in de database. De melding is
  neutraal ("Dat antwoord kun je niet gebruiken…") en verraadt niet dat het antwoord juist was of van wie het is.

---

## 2. Database (supabase/migrations/20261005000000_schema.sql)

| Tabel            | Kolommen (belangrijkste)                                                                 |
|------------------|------------------------------------------------------------------------------------------|
| `games`          | `id`, `room_code`, `status`, `current_question` (0-based), `host_token_hash`, `created_at`, `updated_at` |
| `players`        | `id`, `game_id`, `name`, `name_key`, `token_hash`, `score`, `last_seen_at` (→ "connected"), `created_at` |
| `questions`      | `id`, `game_id`, `position` (0–4), `question`, `correct_answer`, `normalized_answer`    |
| `fake_answers`   | `id`, `question_id`, `player_id`, `answer`, `normalized_answer`                          |
| `answer_options` | `id`, `question_id`, `fake_answer_id` (null = juiste antwoord), `is_correct`, `text`, `position` |
| `votes`          | `id`, `question_id`, `player_id`, `option_id` (= selectedAnswerId)                       |
| `round_scores`   | `question_id`, `player_id`, `points`                                                     |

`connected` is geen opgeslagen vlag maar wordt afgeleid: een speler die in de laatste 15 seconden iets van zich
liet horen, is verbonden. Zo blijft hij nooit onterecht "verbonden" staan als zijn telefoon uitvalt.

**Constraints en garanties**

| Regel                                                   | Hoe gegarandeerd                                                             |
|---------------------------------------------------------|------------------------------------------------------------------------------|
| Roomcode uniek                                          | `unique (room_code)`                                                         |
| Naam uniek per room (hoofdletter-/spatie-ongevoelig)    | `unique (game_id, name_key)`                                                 |
| Max. 30 spelers, ook bij gelijktijdig aanmelden         | `join_game()` vergrendelt het spel (`for update`) en telt                    |
| Max. één nepantwoord per speler per vraag               | `unique (question_id, player_id)`                                            |
| **Nooit twee dezelfde antwoorden binnen één vraag**     | `unique (question_id, normalized_answer)` – de database laat bij een race er precies één door |
| Nepantwoord ≠ juiste antwoord                           | controle in `submit_fake_answer()` + trigger `fake_answers_not_correct`      |
| Max. één stem per speler per vraag                      | `unique (question_id, player_id)` op `votes`                                 |
| Niet op eigen antwoord stemmen                          | trigger `votes_valid`                                                        |
| Precies één juist antwoord per vraag                    | partiële unieke index `answer_options_one_correct`                           |
| Geen negatieve punten                                   | `check (score >= 0)`, `check (points >= 0)`                                  |
| Antwoorden alleen in de juiste fase                     | `submit_fake_answer()` / `cast_vote()` lezen het spel met `for share`; fasewissels nemen `for update`, dus een antwoord kan niet "tussendoor" glippen |
| Punten maar één keer per vraag                          | `reveal_answers()` kan alleen vanuit `VOTING` en zet direct `REVEAL`         |

**Normalisatie** (`src/lib/normalize.ts`): Unicode-normalisatie, accenten weg (é → e), kleine letters,
interpunctie/symbolen → spatie, spaties aan begin en eind weg, meerdere spaties → één.
Dus `"New York"`, `"new york"`, `"  NEW   YORK "`, `"New-York!"` zijn allemaal `new york`.

**Puntentelling** (in `reveal_answers()`): juiste antwoord geraden **+2**, per speler die op jouw nepantwoord
stemt **+1**. Geen minpunten.

---

## 3. Bestandsstructuur

```
nepantwoord/
├─ supabase/
│  ├─ config.toml                      lokale Supabase (CLI)
│  └─ migrations/…_schema.sql          tabellen, constraints, RLS, SQL-spelfuncties
├─ src/
│  ├─ app/                             routes (Next.js App Router)
│  │  ├─ page.tsx                      startscherm: Spel starten / Meedoen
│  │  ├─ nieuw/page.tsx                host: vragen invoeren, ordenen, spel aanmaken
│  │  ├─ meedoen/page.tsx              speler: roomcode + naam
│  │  ├─ host/[code]/page.tsx          hostscherm
│  │  ├─ spel/[code]/page.tsx          spelersscherm
│  │  └─ api/games/…                   API: aanmaken, join, state, answer, vote, host
│  ├─ components/
│  │  ├─ ui/index.tsx                  neutrale bouwstenen (Button, Card, TextField, lijsten, klassement …)
│  │  ├─ game/                         gedeeld: vraagkop, onthulling, eindstand, laad-/foutschermen
│  │  ├─ host/HostGame.tsx             alle hostfases
│  │  └─ player/PlayerGame.tsx         alle spelersfases
│  ├─ lib/
│  │  ├─ constants.ts                  limieten, punten, werktitel
│  │  ├─ errors.ts                     ALLE foutmeldingen (Nederlands)
│  │  ├─ normalize.ts                  normalisatie van antwoorden en namen
│  │  ├─ standings.ts, types.ts
│  │  ├─ server/                       alleen server: Supabase-client, tokens, sessies, statusweergave, realtime
│  │  └─ client/                       alleen browser: API-aanroepen, sessie-opslag, useGame (realtime + polling)
│  └─ styles/
│     ├─ tokens.css                    ← kleuren, lettertypes, afrondingen, afstanden
│     └─ components.css                opmaak van de ui-componenten (gebruikt alleen tokens)
├─ tests/normalize.test.ts             unittests (vitest)
└─ scripts/e2e.ts                      end-to-end test met 30 spelers tegen de echte API + Realtime
```

### Restylen
- Kleuren, typografie, radius, spacing, knophoogtes en breedtes: **`src/styles/tokens.css`**.
- Vorm van de componenten: `src/styles/components.css` (klassen beginnen met `ui-`).
- De spellogica zit niet in de componenten in `components/ui`; die kun je dus vrij herschrijven.

---

## 4. Installeren en online zetten

### Supabase-project
1. Maak een project op [supabase.com](https://supabase.com).
2. Open **SQL Editor**, plak de inhoud van `supabase/migrations/20261005000000_schema.sql` en voer uit.
   (Of met de CLI: `npx supabase link --project-ref <ref>` en `npx supabase db push`.)
3. Controleer bij **Realtime → Settings** dat publieke kanalen zijn toegestaan ("Allow public access" aan,
   dit is de standaard). Het kanaal bevat alleen een leeg "ververs"-signaal.
4. Haal bij **Project Settings → API (Keys)** de URL, de anon/publishable key en de service_role/secret key op.

### Omgevingsvariabelen (zie `.env.example`)
| Variabele                        | Waar           | Geheim? |
|----------------------------------|----------------|---------|
| `NEXT_PUBLIC_SUPABASE_URL`       | browser+server | nee     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | browser        | nee (kan niets lezen door RLS) |
| `SUPABASE_SERVICE_ROLE_KEY`      | alleen server  | **ja**  |

### Hosting (bijv. Vercel)
1. Importeer de repository en zet **Root Directory** op `nepantwoord`.
2. Vul de drie omgevingsvariabelen in en deploy.
Omdat alle status in Supabase staat, werkt dit ook serverless en met meerdere instanties.

### Lokaal ontwikkelen
```bash
cd nepantwoord
npm install
npx supabase start            # vereist Docker; past de migratie automatisch toe
cp .env.example .env.local    # vul de lokale URL en keys in (npx supabase status)
npm run dev                   # http://localhost:3000
```
Met telefoons op hetzelfde wifi: open `http://<ip-van-je-laptop>:3000`. Voor realtime moet
`NEXT_PUBLIC_SUPABASE_URL` dan ook naar dat IP-adres wijzen.

### Tests
```bash
npm test                      # unittests (normalisatie, klassement)
npm run build && npm start    # app draaien, dan in een tweede venster:
npm run test:e2e              # 30 spelers via de echte API + Supabase Realtime
```
De end-to-end test controleert o.a.: verkeerde roomcode, dubbele naam, volle room (ook bij gelijktijdig
aanmelden), meedoen na de start, hostacties door spelers/zonder token, verwijderen uit de lobby, het juiste
antwoord als nepantwoord (in varianten), bestaande antwoorden, **10 spelers die tegelijk "New York" insturen**,
twee antwoorden/stemmen tegelijk van één speler, stemmen op jezelf, gelijke optievolgorde voor iedereen,
geen auteur/juist-markering vóór de onthulling, puntentelling, dubbelklikken op hostknoppen, doorgaan voordat
iedereen klaar is, opnieuw spelen en beëindigen, en dat realtime-berichten geen speldata bevatten.

---

## Edge cases (kort)

| Situatie                                   | Gedrag                                                              |
|--------------------------------------------|---------------------------------------------------------------------|
| Roomcode bestaat niet / spel beëindigd      | "Deze roomcode bestaat niet. Controleer de code…"                   |
| Room vol                                   | "Deze room is vol. Er kunnen maximaal 30 spelers meedoen."           |
| Spel al gestart                            | "Dit spel is al begonnen. Je kunt niet meer meedoen."               |
| Dubbele naam                               | "Deze naam is al in gebruik. Kies een andere naam."                 |
| Speler of host ververst / verliest verbinding | Token in localStorage → automatisch terug; melding "Verbinding verbroken. Opnieuw verbinden…" zolang de server onbereikbaar is |
| Geen nepantwoord ingestuurd                | Mag wel stemmen; verdient alleen punten met het juiste antwoord      |
| Host gaat door voordat iedereen klaar is   | Altijd toegestaan; late inzendingen krijgen "Deze fase is al afgelopen." |
| Speler verwijderd door host (lobby)        | "Je doet niet meer mee aan dit spel."                               |
| Dubbelklik op hostknop / twee tabbladen    | Wordt één keer uitgevoerd                                           |
