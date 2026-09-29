/*
 * Logica pura dei sottotitoli: allineamento punteggiatura, formattazione
 * delle parole e divisione in "pagine" (i blocchi che compaiono a schermo).
 * Nessuna dipendenza da CEP o After Effects, così si testa con Node.
 */
(function (root, factory) {
  // Nel pannello CEP (mixed context) esistono sia window sia module: esponiamo su entrambi.
  var api = factory();
  if (typeof window !== 'undefined') window.Captions = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(this, function () {
  'use strict';

  var PUNCT_RE = /[.,!?;:"'“”‘’«»()[\]{}…¿¡–—-]/g;
  var SENTENCE_END_RE = /[.!?…]["'”»)]*$/;

  function normalize(s) {
    return String(s).toLowerCase().replace(PUNCT_RE, '').trim();
  }

  /*
   * Whisper (API OpenAI) restituisce le parole con i tempi ma senza
   * punteggiatura, mentre il testo completo la contiene. Riporta la
   * punteggiatura sulle parole cercando la corrispondenza nel testo.
   */
  function alignPunctuation(words, fullText) {
    if (!fullText) return words;
    var tokens = String(fullText).split(/\s+/).filter(Boolean);
    var j = 0;
    return words.map(function (w) {
      var target = normalize(w.text);
      for (var k = j; k < Math.min(tokens.length, j + 4); k++) {
        if (normalize(tokens[k]) === target) {
          j = k + 1;
          return Object.assign({}, w, { text: tokens[k] });
        }
      }
      return w;
    });
  }

  function formatWord(text, style) {
    var t = String(text).trim();
    if (style.stripPunctuation) t = t.replace(PUNCT_RE, '');
    if (style.textCase === 'upper') t = t.toUpperCase();
    else if (style.textCase === 'lower') t = t.toLowerCase();
    return t;
  }

  // Divide una lista di parole in righe da massimo maxChars caratteri.
  function layoutLines(texts, maxChars) {
    var lines = [];
    var cur = [];
    var len = 0;
    texts.forEach(function (t, i) {
      var add = cur.length ? t.length + 1 : t.length;
      if (cur.length && len + add > maxChars) {
        lines.push(cur);
        cur = [];
        len = 0;
        add = t.length;
      }
      cur.push(i);
      len += add;
    });
    if (cur.length) lines.push(cur);
    return lines;
  }

  var DEFAULT_GROUPING = {
    maxWords: 3,
    maxCharsPerLine: 16,
    maxLines: 2,
    maxGap: 0.6,
    breakOnPunctuation: true,
    hold: 0.25
  };

  /*
   * words: [{ text, start, end, breakBefore? }] con tempi in secondi.
   * Restituisce le pagine: { words, lines (indici per riga), start, end }.
   */
  function groupPages(words, grouping, style) {
    var g = Object.assign({}, DEFAULT_GROUPING, grouping || {});
    style = style || {};
    var items = words
      .map(function (w) { return Object.assign({}, w, { display: formatWord(w.text, style) }); })
      .filter(function (w) { return w.display.length > 0; });

    var pages = [];
    var cur = [];

    function flush() {
      if (cur.length) pages.push({ words: cur });
      cur = [];
    }

    items.forEach(function (w) {
      if (cur.length) {
        var prev = cur[cur.length - 1];
        var texts = cur.concat([w]).map(function (x) { return x.display; });
        var mustBreak =
          w.breakBefore ||
          cur.length >= g.maxWords ||
          layoutLines(texts, g.maxCharsPerLine).length > g.maxLines ||
          w.start - prev.end > g.maxGap ||
          (g.breakOnPunctuation && SENTENCE_END_RE.test(prev.text.trim()));
        if (mustBreak) flush();
      }
      cur.push(w);
    });
    flush();

    pages.forEach(function (p, i) {
      p.lines = layoutLines(p.words.map(function (w) { return w.display; }), g.maxCharsPerLine);
      p.start = p.words[0].start;
      var last = p.words[p.words.length - 1].end + g.hold;
      var next = pages[i + 1] ? pages[i + 1].words[0].start : Infinity;
      p.end = Math.min(last, next);
      if (p.end <= p.start) p.end = p.start + 0.1;
    });
    return pages;
  }

  // Testo della pagina come lo vuole After Effects: righe separate da \r.
  function pageText(page) {
    return page.lines
      .map(function (line) {
        return line.map(function (i) { return page.words[i].display; }).join(' ');
      })
      .join('\r');
  }

  function formatTime(sec) {
    var m = Math.floor(sec / 60);
    var s = sec - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  }

  return {
    alignPunctuation: alignPunctuation,
    formatWord: formatWord,
    layoutLines: layoutLines,
    groupPages: groupPages,
    pageText: pageText,
    formatTime: formatTime,
    DEFAULT_GROUPING: DEFAULT_GROUPING
  };
});
