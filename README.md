# Leinad Nahad – het feestspel

Een mobiel multiplayer-feestspel in de browser, voor maximaal 16 spelers en één aparte host (spelleider).
Er is geen installatie en er zijn geen accounts nodig. Spelers doen mee met hun naam en een spelcode van 4 letters.

Het spel heeft drie rondes van vijf vragen:

1. **Psych**: open antwoorden over Daniel Dahan, daarna anoniem stemmen (1 punt per ontvangen stem).
2. **Algemene kennis**: open antwoorden binnen 30 seconden, de host keurt goede antwoorden goed (3 punten).
3. **Stellingen**: speel je buiten de telefoon, de host deelt punten uit (3 punten per gekozen speler).

## Techniek

| Onderdeel | Keuze | Waarom |
|---|---|---|
| Backend | **Node.js + Express + Socket.IO** | Eén klein proces dat de website serveert én realtime synchroniseert via websockets. Socket.IO valt automatisch terug op polling en verbindt na wegvallen vanzelf opnieuw. |
| Spelstatus | In het geheugen van de server, opgeslagen in `data/spellen.json` | Geen database nodig. Na een herstart van de server gaan lopende spellen gewoon verder. |
| Frontend | Gewone HTML, CSS en JavaScript (geen build-stap) | Eenvoudig aan te passen en direct opnieuw vorm te geven. |

De server is de enige bron van waarheid. Hij bewaakt fases, deadlines, wie wat mag doen en de puntentelling.
Iedere deelnemer krijgt een eigen, gefilterde weergave van de spelstatus. Antwoorden van anderen, auteurs in ronde 1
en de conceptselectie van de host komen pas bij een deelnemer binnen op het moment dat ze getoond mogen worden.

## Projectstructuur

```
content/vragen.js     ← ALLE VRAGEN EN STELLINGEN (hier pas je de inhoud aan)
server/index.js       HTTP-server, Socket.IO, opslag op schijf, QR-code-endpoint
server/game.js        Spellogica: fases, rechten, timer, punten, weergave per deelnemer
public/index.html     De enige HTML-pagina
public/css/style.css  Vormgeving (kleuren en lettertype als variabelen bovenaan)
public/js/app.js      Alle schermen voor spelers en host
test/                 Geautomatiseerde tests (16 spelers + host, spellogica)
Dockerfile, render.yaml  Hosting
```

## Vragen en stellingen aanpassen

Alle teksten staan in **`content/vragen.js`**. Pas de zinnen tussen de aanhalingstekens aan. Je kunt ook de titels,
de uitleg per ronde en de tijdslimiet van ronde 2 (`tijdslimietSeconden`) wijzigen. Aan de spellogica hoef je niets te veranderen.
Een nieuw spel gebruikt automatisch de nieuwe teksten. Online moet je de wijziging wel opnieuw uitrollen (committen en pushen
volstaat bij Render).

## Lokaal starten

Vereist: [Node.js](https://nodejs.org) 18 of hoger.

```bash
npm install
npm start
```

Open daarna `http://localhost:3000`.

**Met telefoons op hetzelfde wifi-netwerk:** zoek het IP-adres van je laptop op (bijv. `192.168.1.23`) en laat de spelers
`http://192.168.1.23:3000` openen. Het hostscherm toont automatisch het juiste adres en een QR-code als je het hostscherm
ook via dat IP-adres opent.

Tests draaien:

```bash
npm test
```

Instellingen via omgevingsvariabelen (optioneel):

| Variabele | Standaard | Betekenis |
|---|---|---|
| `PORT` | `3000` | Poort van de server |
| `DATA_FILE` | `data/spellen.json` | Bestand waarin spellen worden bewaard. Leeg (`DATA_FILE=`) = niets opslaan |
| `R2_SECONDS` | – | Overschrijft de tijdslimiet van ronde 2 (handig om te testen) |

## Online zetten (aanbevolen: Render)

De app moet als **één doorlopend proces (één instantie)** draaien, omdat de spelstatus in het geheugen van de server staat.
Platforms die alleen serverless functies bieden (zoals Vercel of Netlify) zijn daarom niet geschikt.
Render, Railway en Fly.io werken wel.

### Render (stap voor stap)

1. Maak een gratis account aan op [render.com](https://render.com) en koppel je GitHub-account.
2. Kies **New → Blueprint** en selecteer de repository `LeinadNahad`. Render leest `render.yaml` en maakt de webservice aan.
   (Alternatief: **New → Web Service**, buildcommando `npm ci --omit=dev`, startcommando `npm start`.)
3. Na het bouwen krijg je een adres zoals `https://leinad-nahad.onrender.com`. Deel dat met de spelers.
   Ze kunnen ook de QR-code op het hostscherm scannen.

Let op bij het **gratis** abonnement van Render:
- De server valt na 15 minuten zonder bezoekers in slaap. Het eerste bezoek duurt dan ongeveer een minuut.
  Open de site dus even vóórdat het feest begint.
- De schijf is niet blijvend. Na een herstart of nieuwe uitrol zijn lopende spellen weg.
  Wil je dat niet, kies dan het abonnement **Starter** en voeg eventueel een *Persistent Disk* toe
  (bijv. gekoppeld op `/var/data`, met de omgevingsvariabele `DATA_FILE=/var/data/spellen.json`).
- Rol geen nieuwe versie uit tijdens een lopend spel.

### Railway of Fly.io

Beide kunnen de meegeleverde `Dockerfile` gebruiken. Zorg dat je één instantie draait. Bij Fly.io doe je dat met
`fly scale count 1` en zet je `auto_stop_machines` uit tijdens het spel.

## Hoe het werkt (kort)

- **Host**: kiest *Spel aanmaken*, krijgt een code + QR-code, ziet deelnemers met verbindingsstatus en bedient alle fases.
  Spelers verwijderen kan alleen in de wachtkamer.
- **Spelers**: kiezen *Deelnemen* en vullen code en naam in. Lege en dubbele namen (ongeacht hoofdletters) worden geweigerd.
  Na de start kan niemand meer aansluiten.
- **Opnieuw verbinden**: de identiteit van spelers en host wordt in de browser bewaard (geheim token). Na verversen of
  bij tijdelijk wegvallen kom je terug als dezelfde deelnemer, met dezelfde voortgang. Is het tabblad gesloten, dan toont
  het startscherm de knop *Terug naar het spel*.
- **Nooit dubbele punten**: iedere hostactie hoort bij een vaste spelstap. Een dubbelklik of verouderd scherm wordt
  geweigerd met "Deze actie is al verwerkt". Punten worden per vraag precies één keer toegekend.
- **Wegvallende spelers**: in ronde 1 kan de host de antwoord- en stemfase eerder afsluiten. Ronde 2 sluit vanzelf op de
  deadline. Ronde 3 heeft geen invoer van spelers nodig.
- **Veiligheid**: alle spelerstekst wordt als tekst weergegeven (nooit als HTML). De server weigert hostacties van spelers,
  stemmen op jezelf, dubbele inzendingen en antwoorden na de deadline.

## Getest

`npm test` voert het volgende uit:

- **Volledige spelcyclus met 16 gesimuleerde spelers en een host** via echte websocketverbindingen. Getest worden:
  aansluiten (lege of dubbele naam, 17e speler en aansluiten na de start worden geweigerd), dat spelers geen hostacties
  kunnen doen, alle 5 vragen van ronde 1 (alle antwoorden, vroeg afsluiten, geen antwoorden, één antwoord),
  geheimhouding van antwoorden en auteurs, gelijke stemvolgorde op alle telefoons, niet op jezelf kunnen stemmen,
  stem niet wijzigbaar, opnieuw verbinden van speler en host midden in een vraag, de timer van ronde 2
  (zelfde deadline voor iedereen, te laat insturen geweigerd, vroeg sluiten als iedereen klaar is),
  hostbeoordeling met aanpassen van de selectie, drie gelijktijdige klikken op *Punten bevestigen* (slechts één keer punten),
  ronde 3, de einduitslag met punten per ronde en **gedeelde winnaars**, *Nieuw spel* (alles op nul) en herstart van de server.
- **Unittests** van de spellogica met een nepklok: een antwoord ná de deadline maar vóór het afgaan van de servertimer,
  een gelijke stand, verwijderen en verlaten in de wachtkamer, verouderde of dubbele acties en het opschonen van invoer.
- Handmatig met een echte browser (Chromium, telefoon- en laptopformaat): de complete flow van startscherm tot einduitslag,
  het gedrag van het tekstveld als anderen insturen, verversen tijdens het stemmen, 16 antwoorden in het stemscherm,
  geen horizontaal scrollen en HTML in namen die als tekst wordt getoond.

## Bekende beperkingen

- Eén serverinstantie. Horizontaal schalen naar meerdere servers wordt niet ondersteund (voor dit spel ook niet nodig).
- Zonder blijvende schijf (gratis Render) gaan lopende spellen verloren bij een herstart of nieuwe uitrol.
- De host heeft geen aparte inlog. Wie het hosttoken in zijn browser heeft (het apparaat dat het spel aanmaakte), is de host.
  Open het hostscherm dus niet op een gedeeld apparaat.
- Wie het spel na de start verlaat (bijv. browsergegevens wist), kan niet als nieuwe speler terugkomen.
  Op hetzelfde apparaat en in dezelfde browser gaat terugkeren wel automatisch.
- Foto's en het definitieve ontwerp zijn nog niet verwerkt. Kleuren en lettertype staan als variabelen bovenaan
  `public/css/style.css`.
