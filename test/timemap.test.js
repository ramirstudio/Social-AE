const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/lib/timemap.js');

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('clip semplice spostata e allungata', () => {
  // layer che parte a 2s nella comp, stretch 200%, mostra il file da 0 a 5s
  const seg = [[2, 0], [12, 5]];
  near(M.srcToComp([seg], 1), 4);
  assert.strictEqual(M.srcToComp([seg], 6), null);
});

test('remapping con pausa e ritorno indietro: vale il primo passaggio', () => {
  const seg = [[0, 0], [2, 2], [3, 2], [4, 1], [6, 3]];
  near(M.srcToComp([seg], 1), 1);
  near(M.srcToComp([seg], 2.5), 5.5);
});

test('stesso file in due clip: un solo pezzo da trascrivere, parole mappate su entrambe', () => {
  const a = { filePath: '/v.mp4', segments: [[[0, 10], [3, 13]]] };
  const b = { filePath: '/v.mp4', segments: [[[3, 20], [6, 23]]] };
  const chunks = M.planChunks([a, b]);
  assert.strictEqual(chunks.length, 1);
  assert.deepStrictEqual([chunks[0].srcIn, chunks[0].srcOut], [9.5, 23.5]);
  const words = [{ text: 'uno', start: 11, end: 11.4 }, { text: 'tagliata', start: 15, end: 15.5 }, { text: 'due', start: 21, end: 21.3 }];
  const out = M.mergeWords(chunks[0].tracks.map(tr => M.mapWords(words, tr)));
  assert.deepStrictEqual(out.map(w => [w.text, +w.start.toFixed(3)]), [['uno', 1], ['due', 4]]);
});

test('file lontani nel tempo restano pezzi separati', () => {
  const tr = { filePath: '/v.mp4', segments: [[[0, 0], [2, 2]], [[2, 100], [4, 102]]] };
  assert.strictEqual(M.planChunks([tr]).length, 2);
});

test('toglie i doppioni da camera e microfono', () => {
  const out = M.mergeWords([
    [{ text: 'Ciao', start: 1, end: 1.3 }],
    [{ text: 'ciao,', start: 1.05, end: 1.3 }, { text: 'ciao', start: 2, end: 2.2 }]
  ]);
  assert.deepStrictEqual(out.map(w => w.start), [1, 2]);
});
