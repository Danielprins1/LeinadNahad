// Vaste testvragen (5 per ronde) voor de geautomatiseerde tests. Niet aanpassen voor het echte spel: dat is content/vragen.js.
module.exports = {
  rondes: [
    {
      titel: 'Psych',
      uitleg:
        'Schrijf een grappig of geloofwaardig antwoord over Daniel Dahan. ' +
        'Daarna stemt iedereen op zijn favoriete antwoord. Iedere stem op jouw antwoord levert 1 punt op.',
      vragen: [
        'Wat zou Daniel Dahan als eerste doen als hij een miljoen euro won?',
        'Wat is de grootste geheime angst van Daniel Dahan?',
        'Welk liedje zingt Daniel Dahan stiekem onder de douche?',
        'Wat zou de titel zijn van de autobiografie van Daniel Dahan?',
        'Waarvoor zou Daniel Dahan een prijs winnen?',
      ],
    },
    {
      titel: 'Algemene kennis',
      uitleg:
        'Je hebt 30 seconden om de vraag te beantwoorden. De host beoordeelt de antwoorden. ' +
        'Ieder goed antwoord levert 3 punten op.',
      tijdslimietSeconden: 30,
      vragen: [
        'Wat is de hoofdstad van Australië?',
        'Hoeveel poten heeft een spin?',
        'In welk jaar viel de Berlijnse Muur?',
        'Welk element heeft het scheikundige symbool O?',
        'Wie schilderde de Nachtwacht?',
      ],
    },
    {
      titel: 'Stellingen',
      uitleg:
        'Deze ronde speel je buiten de telefoon. Lees de stelling en voer de opdracht samen uit. ' +
        'De host deelt per stelling 3 punten uit aan de winnaars.',
      stellingen: [
        'Wie het langst op één been kan staan, wint.',
        'De speler die het beste Daniel Dahan kan nadoen, wint.',
        'Wie als eerste iets roods kan laten zien, wint.',
        'Wie het beste verhaal over Daniel Dahan vertelt, wint.',
        'Wie het hardst kan lachen zonder geluid te maken, wint.',
      ],
    },
  ],
};
