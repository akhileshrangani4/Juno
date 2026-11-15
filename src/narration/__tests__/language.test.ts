import { guessLatin, languageCode, languageName, languagesKey, translationCheck, type Languages } from '../language';

const english: Languages = { target: 'en', keep: ['en'] };
const check = (body: string, declared: string[] = [], languages: Languages | null = english) => translationCheck(body, declared, languages).candidate;

describe('deciding whether a post may need translating', () => {
  it('flags text declared in a language the user does not read', () => {
    expect(check('Hoy fuimos al mercado y compramos fruta fresca para toda la semana.', ['es'])).toBe(true);
  });

  it('flags undeclared text that reads as another language', () => {
    expect(check('Hoy fuimos al mercado y compramos fruta fresca para toda la semana.')).toBe(true);
    expect(check("Je ne sais pas pourquoi mais c'est très drôle avec vous.")).toBe(true);
  });

  it('trusts the text over a wrong declaration, both ways', () => {
    expect(check('Hoy fuimos al mercado y compramos fruta fresca para toda la semana.', ['en'])).toBe(true);
    expect(check('We went to the market today and bought fruit for the week.', ['es'])).toBe(false);
  });

  it('reads as it is a post too short or too unclear to tell', () => {
    for (const body of ['lol', '😂😂😂', 'Buenos días', 'gm frens', 'ありがとう', 'Ana & Ben']) expect(check(body, ['es'])).toBe(false);
    expect(check('Silver sketch', ['pt'])).toBe(false);
    expect(check('Wolf commission teehEE', ['nb'])).toBe(false);
  });

  it('flags a script the user does not read, and not one they do', () => {
    const japanese = '今日は東京で友達と美味しいラーメンを食べました。';
    expect(check(japanese)).toBe(true);
    expect(check(japanese, [], { target: 'ja', keep: ['ja'] })).toBe(false);
    expect(check('مرحبا بكم جميعا في هذا اليوم الجميل')).toBe(true);
    expect(check('आज मौसम बहुत अच्छा है और हम पार्क जा रहे हैं', ['hi'], { target: 'en', keep: ['en', 'hi'] })).toBe(false);
    expect(check('आज मौसम बहुत अच्छा है और हम पार्क जा रहे हैं', ['hi'])).toBe(true);
  });

  it('flags Chinese for a Japanese reader only when it is declared as Chinese', () => {
    const chinese = '我们今天去了公园，天气非常好，大家都很开心。';
    expect(check(chinese, ['zh'], { target: 'ja', keep: ['ja'] })).toBe(true);
    expect(check(chinese, [], { target: 'ja', keep: ['ja'] })).toBe(false);
  });

  it('reads as it is a mostly English post with a foreign phrase, and flags a mostly foreign one', () => {
    expect(check('What a great show tonight, the band was amazing and the crowd sang along. Gracias amigos!')).toBe(false);
    expect(check('Que noche increíble con todos mis amigos en el concierto, the best night!')).toBe(true);
  });

  it('never flags anything with translation off', () => {
    expect(check('Hoy fuimos al mercado y compramos fruta fresca para toda la semana.', ['es'], null)).toBe(false);
  });

  it('guesses a Latin-script language only when one clearly leads', () => {
    expect(guessLatin('Der Hund und die Katze sind nicht im Haus')).toBe('de');
    expect(guessLatin('Paris Berlin Tokyo')).toBeNull();
  });

  it('names languages, reads names back to codes, and keys the cache by target and kept languages', () => {
    expect(languageName('es-MX')).toBe('Spanish');
    expect(languageName('xx')).toBe('another language');
    expect(languageCode('spanish')).toBe('es');
    expect(languageCode('pt-BR')).toBe('pt');
    expect(languageCode('Klingon')).toBeNull();
    expect(languagesKey({ target: 'en', keep: ['hi', 'en-GB', 'en'] })).toBe('en>en,hi');
    expect(languagesKey(null)).toBe('');
  });
});
