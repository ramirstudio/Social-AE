const test = require('node:test');
const assert = require('node:assert');
const C = require('../client/lib/captions.js');
const T = require('../client/lib/transcribe.js');

const w = (text, start, end) => ({ text, start, end });

test('riporta la punteggiatura dal testo completo', () => {
  const words = [w('Ciao', 0, 0.3), w('a', 0.3, 0.4), w('tutti', 0.4, 0.8), w('come', 1, 1.2), w('state', 1.2, 1.5)];
  const out = C.alignPunctuation(words, 'Ciao a tutti! Come state?');
  assert.deepStrictEqual(out.map(x => x.text), ['Ciao', 'a', 'tutti!', 'Come', 'state?']);
});

test('divide per numero di parole, fine frase e pause', () => {
  const words = [
    w('uno', 0, 0.2), w('due', 0.2, 0.4), w('tre', 0.4, 0.6), w('quattro.', 0.6, 0.8),
    w('cinque', 0.9, 1.1), w('sei', 3, 3.2)
  ];
  const pages = C.groupPages(words, { maxWords: 3, maxCharsPerLine: 30, maxLines: 2, maxGap: 0.6 }, {});
  assert.deepStrictEqual(pages.map(p => p.words.map(x => x.text)), [['uno', 'due', 'tre'], ['quattro.'], ['cinque'], ['sei']]);
  assert.strictEqual(pages[0].end, 0.6); // non oltre l'inizio del blocco dopo
});

test('rispetta caratteri per riga e righe massime', () => {
  const words = ['questa', 'frase', 'lunga', 'va', 'a', 'capo'].map((t, i) => w(t, i * 0.2, i * 0.2 + 0.2));
  const pages = C.groupPages(words, { maxWords: 10, maxCharsPerLine: 12, maxLines: 2, breakOnPunctuation: false }, { textCase: 'upper' });
  assert.strictEqual(C.pageText(pages[0]), 'QUESTA FRASE\rLUNGA VA A');
  assert.strictEqual(C.pageText(pages[1]), 'CAPO');
});

test('breakBefore forza un nuovo blocco e la punteggiatura può sparire', () => {
  const words = [w('Ok,', 0, 0.2), w('via', 0.2, 0.4), Object.assign(w('adesso', 0.4, 0.6), { breakBefore: true })];
  const pages = C.groupPages(words, { maxWords: 5 }, { stripPunctuation: true });
  assert.deepStrictEqual(pages.map(C.pageText), ['Ok via', 'adesso']);
});

test('whisper.cpp: unisce i frammenti senza spazio iniziale', () => {
  const json = { transcription: [
    { offsets: { from: 0, to: 300 }, text: ' Ciao' },
    { offsets: { from: 300, to: 350 }, text: ',' },
    { offsets: { from: 400, to: 700 }, text: ' mondo' },
    { offsets: { from: 700, to: 900 }, text: ' [_TT_]' }
  ] };
  const r = T.parseWhisperCppJson(json);
  assert.deepStrictEqual(r.words, [w('Ciao,', 0, 0.35), w('mondo', 0.4, 0.7)]);
});

test('OpenAI: legge le parole di verbose_json', () => {
  const r = T.parseOpenAIResponse({ text: 'Ciao mondo.', words: [{ word: ' Ciao', start: 0, end: 0.3 }, { word: 'mondo', start: 0.3, end: 0.7 }] });
  assert.deepStrictEqual(r.words.map(x => x.text), ['Ciao', 'mondo']);
});
