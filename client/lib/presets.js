/*
 * Stili di partenza. Ogni preset sovrascrive solo i campi che elenca.
 */
(function () {
  'use strict';

  var BASE = {
    font: 'Montserrat-Black',
    fontSize: 90,
    tracking: 0,
    leading: 0,
    textCase: 'upper',
    fillColor: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: 12,
    posY: 0.7,
    highlight: true,
    highlightColor: '#ffe14d',
    highlightScale: 110,
    dimOthers: false,
    dimOpacity: 45,
    reveal: false,
    maxWords: 3,
    maxCharsPerLine: 16,
    maxLines: 2,
    maxGap: 0.6,
    breakOnPunctuation: true,
    stripPunctuation: true,
    popIn: true,
    popFrom: 80,
    shadow: true,
    shadowDistance: 6,
    shadowSoftness: 18,
    box: false,
    boxColor: '#ff3b5c',
    boxOpacity: 100,
    boxPadding: 14,
    boxRadius: 14
  };

  var PRESETS = {
    classico: { label: 'Classico bianco e giallo' },
    verde: { label: 'Parola attiva verde', highlightColor: '#3ddc84', highlightScale: 118, maxWords: 2 },
    singola: {
      label: 'Una parola alla volta',
      maxWords: 1, fontSize: 120, highlight: false, popFrom: 65
    },
    karaoke: {
      label: 'Karaoke',
      textCase: 'none', maxWords: 6, maxCharsPerLine: 22, highlightScale: 100,
      dimOthers: true, dimOpacity: 40, fontSize: 72, stripPunctuation: false
    },
    comparsa: {
      label: 'Parole che compaiono',
      reveal: true, maxWords: 5, maxCharsPerLine: 20, highlightScale: 100, fontSize: 78
    },
    riquadro: {
      label: 'Riquadro sulla parola',
      box: true, highlightColor: '#ffffff', highlightScale: 105, strokeWidth: 0, shadow: false
    },
    sobrio: {
      label: 'Sobrio',
      textCase: 'none', strokeWidth: 0, highlightColor: '#ffffff', highlightScale: 100,
      dimOthers: true, dimOpacity: 60, fontSize: 64, maxWords: 5, maxCharsPerLine: 26,
      popIn: false, shadowDistance: 3, shadowSoftness: 30, stripPunctuation: false
    }
  };

  function get(key) {
    var p = Object.assign({}, BASE, PRESETS[key] || {});
    delete p.label;
    return p;
  }

  window.Presets = { BASE: BASE, PRESETS: PRESETS, get: get };
})();
