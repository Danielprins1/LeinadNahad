/**
 * ALLE VRAGEN EN STELLINGEN STAAN IN DIT BESTAND.
 *
 * Je kunt de teksten hieronder vrij aanpassen, toevoegen of verwijderen
 * zonder de spellogica te wijzigen. Let op:
 *  - Houd de volgorde van de drie rondes aan (Psych, Algemene kennis, Stellingen).
 *  - Iedere ronde heeft minimaal één vraag/stelling nodig; het aantal per ronde mag verschillen.
 *  - Zet iedere tekst tussen enkele aanhalingstekens en sluit af met een komma.
 *    Gebruik je zelf een apostrof in de tekst? Schrijf dan \' (bijv. 'Daniel\'s auto').
 *  - Foto bij een vraag? Zet het bestand in public/fotos/ en schrijf de vraag als
 *    { tekst: 'De vraag', fotos: ['naam.jpg'] }  (jpg, png, webp of gif).
 *  - Uitbeeldvraag (alleen ronde 2): geen timer en geen invulvak, de host deelt de punten uit.
 *    Schrijf de vraag als  { tekst: 'De vraag', uitbeelden: true }.
 *  - Wijzigingen gelden voor ieder spel dat daarna wordt aangemaakt (of via
 *    'Nieuw spel' opnieuw begint). Een spel dat al loopt houdt zijn vragen.
 *    Draait de server online, dan moet je de wijziging wel opnieuw uitrollen.
 */
module.exports = {
  rondes: [
    {
      titel: 'Psych',
      uitleg:
        'Schrijf het grappigste antwoord over Daniel. ' +
        'Daarna stemt iedereen op zijn favoriete antwoord. Iedere stem op jouw antwoord levert 1 punt op.',
      vragen: [
        {
          tekst: 'Daniel heeft Isa geil gemaakt door één zin te zeggen. Welke zin was dat?',
          fotos: ['isa-1.webp', 'isa-2.webp'],
        },
        {
          tekst: 'Waarom is Daniel te laat bij zijn sollicitatie, en hoe fixt hij de job?',
          fotos: ['outfit.jpg'],
        },
        {
          tekst: 'Daniel zit bij de EHBO. Wat is er gebeurd?',
          fotos: ['ehbo-vest.jpg', 'sprong-boot.jpg'],
        },
        {
          tekst: 'Daniel gaat op vakantie. Wat zit er in zijn tas?',
          fotos: ['aubergine.jpg', 'groepsreis.jpg'],
        },
        {
          tekst: 'Daniel ziet een vrouw. Wat doet hij?',
          fotos: ['schouder.jpg'],
        },
        {
          tekst: 'Daniel belt je om 2 uur ’s nachts. Waarom belt hij?',
          fotos: ['slapen.jpg'],
        },
      ],
    },
    {
      titel: 'Algemene kennis over Daniel',
      uitleg:
        'Hoe goed ken jij Daniel? Je hebt 30 seconden om de vraag te beantwoorden. ' +
        'De host beoordeelt de antwoorden. Ieder goed antwoord levert 3 punten op.',
      tijdslimietSeconden: 30,
      vragen: [
        {
          tekst: 'Wat is de lengte van Daniels hoofd?',
          fotos: ['hoofd-close-up.jpg'],
        },
        {
          tekst:
            'Daniel is voorzitter bij de Joodse jeugdbeweging Haboniem. Op de algemene ledenvergadering voor de begeleiders ' +
            'wordt besproken wanneer er gescholden mag worden in het bijzijn van de oudste kinderen. ' +
            'Welk woord verdedigt Daniel, en waarom?',
          fotos: ['daniel-haboniem.webp', 'haboniem-groep.jpg'],
        },
        {
          tekst: 'Wat zei Daniel aan de telefoon toen hij werd gebeld met de vraag of hij al wakker was voor zijn vlucht?',
          fotos: ['ko-op-de-bank.jpg'],
        },
      ],
    },
    {
      titel: 'Hoe heeft Daniel gehandeld?',
      uitleg:
        'Lees de situatie voor en bespreek samen hoe Daniel heeft gehandeld. ' +
        'De host deelt per situatie 3 punten uit aan de spelers die het (bijna) goed hadden.',
      stellingen: [
        {
          tekst: 'Daniel filmt zichzelf en er staat een Chinese vrouw (Meiling) achter hem. Wat gebeurt er daarna?',
          fotos: ['klas.jpg'],
        },
        {
          tekst:
            'In een leegstaand kantoorgebouw gooit Daniel shit van het dak. Hij knipt een zware deur uit de scharnieren ' +
            'en gooit die ook van het dak. De deur valt op zijn fiets, die helemaal plat is. ' +
            'Wat heeft hij tegen zijn ouders gezegd?',
          fotos: ['tunnel.jpg'],
        },
        {
          tekst: 'Daniel viert zijn verjaardag bij Yesher thuis en ziet een bank. Wat wilde hij doen, en wat was de aftermath?',
          fotos: ['handdruk.jpg'],
        },
        {
          tekst:
            'Daniel is op Thuishaven en ziet een leuke dame staan, binnen in de Loods. Hij gaat met haar kletsen, ' +
            'maar voelt iets in zijn buik borrelen. Wat doet hij?',
          fotos: ['etentje.jpg'],
        },
      ],
    },
  ],
};
