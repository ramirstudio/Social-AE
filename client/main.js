/* global AE, Captions, Transcribe, TimeMap, Presets */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var STORE_KEY = 'socialae.v1';
  var PRESETS_KEY = 'socialae.presets';
  var SETTING_KEYS = ['engine', 'apiKey', 'whisperPath', 'whisperModel', 'ffmpegPath', 'prompt', 'language'];
  var STYLE_KEYS = Object.keys(Presets.BASE);
  var GROUPING_KEYS = ['maxWords', 'maxCharsPerLine', 'maxLines', 'maxGap', 'breakOnPunctuation'];
  var SAMPLE = 'Questa è un\'anteprima di come appariranno i tuoi sottotitoli'.split(' ');

  var state = {
    source: null,     // risposta di SAE_getSources
    words: [],        // { text, start, end, breakBefore } in secondi di composizione
    comp: { width: 1080, height: 1920 },
    fonts: {},        // postScriptName -> { family, style }
    preset: '',       // preset attivo: chiave di Presets.PRESETS o 'u:<nome>' per quelli dell'utente
    custom: {},       // preset dell'utente: nome -> stile completo
    frame: '',        // PNG del fotogramma della comp usato come sfondo dell'anteprima
    zoom: false
  };

  /* ---------- Persistenza ---------- */

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }

  function save() {
    var data = { settings: {}, style: readStyle(), words: state.words, comp: state.comp, preset: state.preset };
    SETTING_KEYS.forEach(function (k) { data.settings[k] = $(k).value; });
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) { /* storage non disponibile */ }
  }

  // I preset dell'utente stanno in una chiave separata: sopravvivono a tutto il resto.
  function loadCustom() {
    try { return JSON.parse(localStorage.getItem(PRESETS_KEY)) || {}; } catch (e) { return {}; }
  }

  function saveCustom() {
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(state.custom)); } catch (e) { /* storage non disponibile */ }
  }

  /* ---------- Stato UI ---------- */

  function setStatus(msg, kind) {
    var el = $('status');
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' is-' + kind : '');
  }

  function busy(on) {
    document.body.classList.toggle('is-busy', on);
    ['btn-pick', 'btn-transcribe', 'btn-generate', 'btn-remove'].forEach(function (id) { $(id).disabled = on; });
    if (!on) refreshButtons();
  }

  function refreshButtons() {
    $('btn-transcribe').disabled = !state.source;
    $('btn-generate').disabled = state.words.length === 0;
  }

  function fail(err) {
    setStatus(err.message || String(err), 'error');
  }

  /* ---------- Stile ---------- */

  function readStyle() {
    var st = {};
    STYLE_KEYS.forEach(function (k) {
      var el = $(k);
      if (el.type === 'checkbox') st[k] = el.checked;
      else if (el.type === 'number' || el.type === 'range') st[k] = parseFloat(el.value) || 0;
      else st[k] = el.value;
    });
    return st;
  }

  function writeStyle(st) {
    STYLE_KEYS.forEach(function (k) {
      if (!(k in st)) return;
      var el = $(k);
      if (el.type === 'checkbox') el.checked = !!st[k];
      else el.value = st[k];
    });
    updateFontNote();
    syncDisabled();
    syncRanges();
  }

  // Parte riempita dello slider e valore accanto all'etichetta.
  function syncRanges() {
    document.querySelectorAll('input[type=range]').forEach(function (r) {
      var pct = (r.value - r.min) / (r.max - r.min) * 100;
      r.style.setProperty('--fill', pct + '%');
      var out = document.querySelector('output[for="' + r.id + '"]');
      if (out) out.textContent = Math.round(r.value * 100) + '%';
    });
  }

  function syncChips() {
    document.querySelectorAll('#preset-chips .chip').forEach(function (c) {
      c.classList.toggle('sel', c.dataset.preset === state.preset);
    });
    $('btn-preset-delete').hidden = state.preset.indexOf('u:') !== 0;
    if (state.preset.indexOf('u:') === 0) $('preset-name').value = state.preset.slice(2);
  }

  /* ---------- Preset ---------- */

  function addChip(key, label, mine) {
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (mine ? ' mine' : '');
    chip.dataset.preset = key;
    chip.textContent = label;
    chip.title = mine ? 'Preset salvato da te' : '';
    chip.addEventListener('click', function () { applyPreset(key); });
    $('preset-chips').appendChild(chip);
  }

  function renderChips() {
    $('preset-chips').innerHTML = '';
    Object.keys(Presets.PRESETS).forEach(function (k) { addChip(k, Presets.PRESETS[k].label, false); });
    Object.keys(state.custom).sort().forEach(function (name) { addChip('u:' + name, name, true); });
    syncChips();
  }

  function applyPreset(key) {
    if (key.indexOf('u:') === 0) {
      // I preset dell'utente riportano tutto, font compreso.
      writeStyle(Object.assign({}, Presets.BASE, state.custom[key.slice(2)]));
    } else {
      var font = $('font').value; // quelli di serie cambiano l'aspetto, non il carattere scelto
      writeStyle(Presets.get(key));
      if (font) $('font').value = font;
      updateFontNote();
    }
    state.preset = key;
    syncChips();
    save();
    renderPages();
    renderPreview(true);
  }

  function savePreset() {
    var name = $('preset-name').value.trim();
    if (!name) { setStatus('Scrivi un nome per il preset.', 'error'); $('preset-name').focus(); return; }
    var existed = name in state.custom;
    state.custom[name] = readStyle();
    saveCustom();
    state.preset = 'u:' + name;
    renderChips();
    save();
    setStatus(existed ? 'Preset "' + name + '" aggiornato.' : 'Preset "' + name + '" salvato.', 'ok');
  }

  function deletePreset() {
    var name = state.preset.slice(2);
    if (!(name in state.custom)) return;
    if (!window.confirm('Eliminare il preset "' + name + '"?')) return;
    delete state.custom[name];
    saveCustom();
    state.preset = '';
    $('preset-name').value = '';
    renderChips();
    save();
    setStatus('Preset "' + name + '" eliminato.', 'ok');
  }

  function exportPresets() {
    if (!Object.keys(state.custom).length) { setStatus('Non hai ancora preset salvati.', 'error'); return; }
    var r = window.cep.fs.showSaveDialogEx('Esporta preset', '', ['json'], 'social-ae-preset.json');
    if (r.err || !r.data) return;
    var file = /\.json$/i.test(r.data) ? r.data : r.data + '.json';
    try {
      require('fs').writeFileSync(file, JSON.stringify({ socialAePresets: 1, presets: state.custom }, null, 2));
      setStatus(Object.keys(state.custom).length + ' preset esportati.', 'ok');
    } catch (e) { fail(e); }
  }

  function importPresets() {
    var r = window.cep.fs.showOpenDialogEx(false, false, 'Importa preset', '', ['json']);
    if (r.err || !r.data || !r.data.length) return;
    try {
      var data = JSON.parse(require('fs').readFileSync(r.data[0], 'utf8'));
      var presets = data && data.presets;
      if (!presets || typeof presets !== 'object') throw new Error('Il file non contiene preset di Social AE.');
      var n = 0;
      Object.keys(presets).forEach(function (name) {
        var st = {};
        // Solo le chiavi di stile conosciute: un file modificato a mano non rompe il pannello.
        STYLE_KEYS.forEach(function (k) { if (k in presets[name]) st[k] = presets[name][k]; });
        state.custom[name] = st;
        n++;
      });
      saveCustom();
      renderChips();
      setStatus(n + ' preset importati.', 'ok');
    } catch (e) { fail(e); }
  }

  function syncDisabled() {
    var st = readStyle();
    $('highlightColor').disabled = !st.highlight;
    $('highlightScale').disabled = !st.highlight;
    $('dimOpacity').disabled = !st.dimOthers;
    $('popFrom').disabled = !st.popIn;
    $('shadowDistance').disabled = !st.shadow;
    $('shadowSoftness').disabled = !st.shadow;
    ['boxColor', 'boxOpacity', 'boxPadding', 'boxRadius'].forEach(function (k) { $(k).disabled = !st.box; });
  }

  function hexToRgb(hex) {
    var n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }

  function grouping(st) {
    var g = {};
    GROUPING_KEYS.forEach(function (k) { g[k] = st[k]; });
    return g;
  }

  function buildPages() {
    var st = readStyle();
    var indexed = state.words.map(function (w, i) { return Object.assign({ idx: i }, w); });
    return Captions.groupPages(indexed, grouping(st), st);
  }

  /* ---------- Font ---------- */

  function fontInfo(ps) {
    if (state.fonts[ps]) return state.fonts[ps];
    var parts = String(ps).split('-');
    return { family: parts[0].replace(/([a-z])([A-Z])/g, '$1 $2'), style: parts[1] || 'Regular', guessed: true };
  }

  function fontWeight(styleName) {
    var s = String(styleName).toLowerCase();
    if (/black|heavy|ultra/.test(s)) return 900;
    if (/extra ?bold/.test(s)) return 800;
    if (/semi ?bold|demi/.test(s)) return 600;
    if (/bold/.test(s)) return 700;
    if (/medium/.test(s)) return 500;
    if (/light|thin/.test(s)) return 300;
    return 400;
  }

  function updateFontNote() {
    var ps = $('font').value;
    var note = $('font-note');
    var hasList = Object.keys(state.fonts).length > 0;
    if (!ps) note.textContent = '';
    else if (state.fonts[ps]) note.textContent = state.fonts[ps].family + ' ' + state.fonts[ps].style;
    else if (hasList) note.textContent = 'Font non trovato tra quelli installati: After Effects userà quello predefinito.';
    else note.textContent = 'Usa il nome PostScript (lo trovi nel pannello Carattere di After Effects).';
  }

  function loadFonts() {
    AE.call('SAE_getFonts').then(function (res) {
      var list = $('font-list');
      var frag = document.createDocumentFragment();
      res.fonts.forEach(function (f) {
        state.fonts[f.ps] = { family: f.family, style: f.style };
        var opt = document.createElement('option');
        opt.value = f.ps;
        opt.label = f.family + ' ' + f.style;
        frag.appendChild(opt);
      });
      list.appendChild(frag);
      updateFontNote();
      renderPreview(true);
    }).catch(function () { /* fuori da AE o versione senza app.fonts */ });
  }

  /* ---------- Trascrizione: elenco blocchi ---------- */

  function renderPages() {
    var box = $('pages');
    box.innerHTML = '';
    if (!state.words.length) {
      box.innerHTML = '<p class="empty">La trascrizione comparirà qui, divisa nei blocchi che andranno a schermo.</p>';
      return;
    }
    buildPages().forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'page';
      var time = document.createElement('span');
      time.className = 'page-time';
      time.textContent = Captions.formatTime(p.start);
      var words = document.createElement('div');
      words.className = 'page-words';
      p.lines.forEach(function (line, li) {
        if (li > 0) words.appendChild(document.createElement('br'));
        line.forEach(function (wi) {
          var w = p.words[wi];
          var span = document.createElement('span');
          span.className = 'word' + (state.words[w.idx].breakBefore ? ' is-break' : '');
          span.textContent = w.display;
          span.dataset.idx = w.idx;
          span.title = Captions.formatTime(w.start) + ' – ' + Captions.formatTime(w.end);
          words.appendChild(span);
          words.appendChild(document.createTextNode(' '));
        });
      });
      row.appendChild(time);
      row.appendChild(words);
      box.appendChild(row);
    });
  }

  function commitEdit(span) {
    var idx = +span.dataset.idx;
    var w = state.words[idx];
    var parts = span.textContent.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      state.words.splice(idx, 1);
    } else if (parts.length === 1) {
      w.text = parts[0];
    } else {
      // Una parola diventata più parole: si divide il suo tempo in parti uguali.
      var step = (w.end - w.start) / parts.length;
      var repl = parts.map(function (t, i) {
        return { text: t, start: w.start + step * i, end: w.start + step * (i + 1), breakBefore: i === 0 && w.breakBefore };
      });
      state.words.splice.apply(state.words, [idx, 1].concat(repl));
    }
    save();
    renderPages();
    renderPreview(true);
    refreshButtons();
  }

  function bindPageEditing() {
    var box = $('pages');
    box.addEventListener('click', function (e) {
      var span = e.target.closest('.word');
      if (!span || !e.shiftKey) return;
      var w = state.words[+span.dataset.idx];
      w.breakBefore = !w.breakBefore;
      save();
      renderPages();
    });
    box.addEventListener('dblclick', function (e) {
      var span = e.target.closest('.word');
      if (!span) return;
      var w = state.words[+span.dataset.idx];
      span.textContent = w.text; // si corregge il testo originale, non quello formattato
      span.contentEditable = 'true';
      span.classList.add('is-editing');
      span.focus();
      document.getSelection().selectAllChildren(span);
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        commitEdit(span);
      }
      span.addEventListener('blur', finish, { once: true });
      span.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); span.blur(); }
        if (ev.key === 'Escape') { span.textContent = w.text; span.blur(); }
      });
    });
  }

  /* ---------- Anteprima ---------- */

  var preview = { pages: [], key: '', pageIdx: -1, wordIdx: -2, t0: 0 };

  function previewPages() {
    if (state.words.length) {
      var pages = buildPages().slice(0, 4);
      var offset = pages[0].start;
      return pages.map(function (p) {
        return {
          lines: p.lines,
          words: p.words.map(function (w) { return { display: w.display, start: w.start - offset }; }),
          start: p.start - offset,
          end: p.end - offset
        };
      });
    }
    var st = readStyle();
    var fake = SAMPLE.map(function (t, i) { return { text: t, start: i * 0.38, end: i * 0.38 + 0.34 }; });
    return Captions.groupPages(fake, grouping(st), st);
  }

  function renderPreview(rebuild) {
    var st = readStyle();
    var box = $('preview');
    box.style.aspectRatio = state.comp.width + ' / ' + state.comp.height;
    // Verticale: largo quanto il pannello ma non oltre 280 px, se no occupa tutta la scheda.
    var avail = box.parentNode.clientWidth || 300;
    box.style.width = (state.comp.height > state.comp.width ? Math.min(avail, 280) : avail) + 'px';
    var scale = box.clientWidth / state.comp.width || 0.2;
    var canvas = $('preview-canvas');
    canvas.style.transformOrigin = '50% ' + (st.posY * 100) + '%';
    canvas.style.transform = state.zoom ? 'scale(1.6)' : '';
    $('btn-zoom').textContent = state.zoom ? 'Vista intera' : 'Zoom sul testo';
    $('preview-label').textContent = state.zoom ? 'zoom 1,6×' : 'anteprima';
    var el = $('preview-text');
    var info = fontInfo(st.font);
    el.style.fontFamily = '"' + info.family + '", "' + st.font + '", sans-serif';
    el.style.fontWeight = fontWeight(info.style);
    el.style.fontSize = (st.fontSize * scale) + 'px';
    el.style.letterSpacing = (st.tracking / 1000) + 'em';
    el.style.lineHeight = st.leading > 0 ? (st.leading * scale) + 'px' : '1.2';
    el.style.color = st.fillColor;
    el.style.top = (st.posY * 100) + '%';
    el.style.webkitTextStroke = st.strokeWidth > 0 ? (st.strokeWidth * scale) + 'px ' + st.strokeColor : '0';
    el.style.textShadow = st.shadow
      ? '0 ' + (st.shadowDistance * scale) + 'px ' + (st.shadowSoftness * scale * 0.5) + 'px rgba(0,0,0,0.55)'
      : 'none';
    el.style.setProperty('--hl', st.highlightColor);
    el.style.setProperty('--hl-scale', st.highlight ? st.highlightScale / 100 : 1);
    el.style.setProperty('--dim', st.dimOthers ? st.dimOpacity / 100 : 1);
    el.style.setProperty('--pop', st.popFrom / 100);
    el.classList.toggle('has-highlight', st.highlight);
    el.classList.toggle('has-reveal', st.reveal);
    el.classList.toggle('has-pop', st.popIn);
    el.classList.toggle('has-box', st.box);
    el.style.setProperty('--box', st.boxColor);
    el.style.setProperty('--box-opacity', st.boxOpacity / 100);
    el.style.setProperty('--box-pad', (st.boxPadding * scale) + 'px');
    el.style.setProperty('--box-radius', (st.boxRadius * scale) + 'px');
    if (rebuild) {
      preview.pages = previewPages();
      preview.pageIdx = -1;
      preview.t0 = performance.now();
    }
  }

  function tickPreview(now) {
    var pages = preview.pages;
    if (pages.length) {
      var total = pages[pages.length - 1].end + 0.6;
      var t = ((now - preview.t0) / 1000) % total;
      var pi = -1;
      for (var i = 0; i < pages.length; i++) if (t >= pages[i].start && t < pages[i].end) pi = i;
      var el = $('preview-text');
      if (pi !== preview.pageIdx) {
        preview.pageIdx = pi;
        preview.wordIdx = -2;
        el.innerHTML = '';
        if (pi >= 0) {
          pages[pi].lines.forEach(function (line, li) {
            if (li > 0) el.appendChild(document.createElement('br'));
            line.forEach(function (wi, k) {
              if (k > 0) el.appendChild(document.createTextNode(' '));
              var s = document.createElement('span');
              s.className = 'pw';
              s.textContent = pages[pi].words[wi].display;
              s.dataset.i = wi;
              el.appendChild(s);
            });
          });
          el.classList.remove('is-popping');
          void el.offsetWidth; // riavvia l'animazione CSS
          el.classList.add('is-popping');
        }
      }
      if (pi >= 0) {
        var ws = pages[pi].words;
        var wi2 = -1;
        for (var j = 0; j < ws.length; j++) if (t >= ws[j].start) wi2 = j;
        if (wi2 !== preview.wordIdx) {
          preview.wordIdx = wi2;
          Array.prototype.forEach.call(el.querySelectorAll('.pw'), function (s) {
            var n = +s.dataset.i;
            s.classList.toggle('is-active', n === wi2);
            s.classList.toggle('is-future', n > wi2);
          });
        }
      }
    }
    requestAnimationFrame(tickPreview);
  }

  /* ---------- Azioni ---------- */

  function describeSource() {
    var s = state.source;
    var info = $('source-info');
    if (!s) { info.textContent = 'Nessun audio letto.'; return; }
    var total = 0;
    s.tracks.forEach(function (tr) {
      tr.segments.forEach(function (seg) { total += seg[seg.length - 1][0] - seg[0][0]; });
    });
    info.innerHTML = '';
    var strong = document.createElement('strong');
    strong.textContent = s.tracks.length === 1 ? s.tracks[0].name : s.tracks.length + ' clip audio';
    info.appendChild(strong);
    info.appendChild(document.createTextNode(' in ' + s.comp.name + ', ' + Captions.formatTime(total) + ' di audio' +
      (s.remap ? ', con remapping' : '')));
    info.title = s.tracks.map(function (tr) { return tr.name; }).join('\n');
  }

  function pickLayer() {
    busy(true);
    setStatus('Leggo i layer…');
    return AE.call('SAE_getSources').then(function (res) {
      state.source = res;
      state.comp = { width: res.comp.width, height: res.comp.height };
      describeSource();
      renderPreview(false);
      save();
      setStatus('');
    }).catch(fail).then(function () { busy(false); });
  }

  function transcribe() {
    var settings = {};
    SETTING_KEYS.forEach(function (k) { settings[k] = $(k).value.trim(); });
    var chunks = TimeMap.planChunks(state.source.tracks);
    var lists = [];

    busy(true);
    // Un pezzo alla volta: ffmpeg e l'API non vanno sovraccaricati in parallelo.
    var chain = Promise.resolve();
    chunks.forEach(function (chunk, n) {
      chain = chain.then(function () {
        var prefix = chunks.length > 1 ? '(' + (n + 1) + ' di ' + chunks.length + ') ' : '';
        return Transcribe.transcribe(chunk, settings, function (msg) { setStatus(prefix + msg); });
      }).then(function (res) {
        var words = settings.engine === 'openai' ? Captions.alignPunctuation(res.words, res.text) : res.words;
        chunk.tracks.forEach(function (tr) { lists.push(TimeMap.mapWords(words, tr)); });
      });
    });

    chain.then(function () {
      state.words = TimeMap.mergeWords(lists);
      save();
      renderPages();
      renderPreview(true);
      setStatus(state.words.length ? state.words.length + ' parole trascritte.' : 'Nessuna parola riconosciuta.', state.words.length ? 'ok' : 'error');
    }).catch(fail).then(function () { busy(false); });
  }

  function generate() {
    var st = readStyle();
    var pages = buildPages().map(function (p) {
      return {
        text: Captions.pageText(p),
        lines: p.lines.map(function (line) { return line.map(function (i) { return p.words[i].display; }); }),
        starts: p.words.map(function (w) { return w.start; }),
        start: Math.max(0, p.start),
        end: p.end
      };
    });
    var hostStyle = Object.assign({}, st, {
      fillColor: hexToRgb(st.fillColor),
      strokeColor: hexToRgb(st.strokeColor),
      highlightColor: hexToRgb(st.highlightColor),
      boxColor: hexToRgb(st.boxColor)
    });
    busy(true);
    setStatus('Creo i layer di testo…');
    AE.call('SAE_createCaptions', { pages: pages, style: hostStyle, replace: $('replace').checked })
      .then(function (res) {
        var msg = res.created + ' sottotitoli creati.';
        if (res.fontMissing) msg += ' Font non trovato, usato quello predefinito.';
        setStatus(msg, res.fontMissing ? 'error' : 'ok');
      })
      .catch(fail)
      .then(function () { busy(false); });
  }

  function removeCaptions() {
    AE.call('SAE_removeCaptions').then(function (res) {
      setStatus(res.removed + ' sottotitoli rimossi.', 'ok');
    }).catch(fail);
  }

  /* ---------- File ---------- */

  function saveTranscript() {
    if (!state.words.length) { setStatus('Non c\'è niente da salvare.', 'error'); return; }
    var r = window.cep.fs.showSaveDialogEx('Salva trascrizione', '', ['json'], 'trascrizione.json');
    if (r.err || !r.data) return;
    var file = /\.json$/i.test(r.data) ? r.data : r.data + '.json';
    try {
      require('fs').writeFileSync(file, JSON.stringify({ version: 1, comp: state.comp, words: state.words }, null, 2));
      setStatus('Trascrizione salvata.', 'ok');
    } catch (e) { fail(e); }
  }

  function loadTranscript() {
    var r = window.cep.fs.showOpenDialogEx(false, false, 'Carica trascrizione', '', ['json']);
    if (r.err || !r.data || !r.data.length) return;
    try {
      var data = JSON.parse(require('fs').readFileSync(r.data[0], 'utf8'));
      if (!Array.isArray(data.words)) throw new Error('File non valido: manca l\'elenco delle parole.');
      state.words = data.words;
      if (data.comp) state.comp = data.comp;
      save();
      renderPages();
      renderPreview(true);
      refreshButtons();
      setStatus(state.words.length + ' parole caricate.', 'ok');
    } catch (e) { fail(e); }
  }

  function browse(targetId) {
    var r = window.cep.fs.showOpenDialogEx(false, false, 'Scegli il file', '', []);
    if (r.err || !r.data || !r.data.length) return;
    $(targetId).value = r.data[0];
    save();
  }

  /* ---------- Fotogramma della comp nell'anteprima ---------- */

  function setFrame(file) {
    state.frame = file;
    var canvas = $('preview-canvas');
    canvas.style.backgroundImage = file
      ? 'url("file:///' + file.replace(/\\/g, '/').replace(/^\/+/, '') + '?t=' + Date.now() + '")'
      : '';
    canvas.classList.toggle('has-frame', !!file);
    $('btn-frame').textContent = file ? 'Aggiorna il fotogramma' : 'Usa il fotogramma della comp';
    $('btn-frame-clear').hidden = !file;
  }

  // After Effects scrive il PNG in modo asincrono: si aspetta che il file compaia e smetta di crescere.
  function waitForFile(file, timeoutMs) {
    var fs = require('fs');
    var t0 = Date.now();
    var lastSize = -1;
    return new Promise(function (resolve, reject) {
      (function check() {
        var size = -1;
        try { size = fs.statSync(file).size; } catch (e) { /* non ancora creato */ }
        if (size > 0 && size === lastSize) return resolve(file);
        lastSize = size;
        if (Date.now() - t0 > timeoutMs) return reject(new Error('After Effects non ha salvato il fotogramma.'));
        setTimeout(check, 150);
      })();
    });
  }

  function grabFrame() {
    var path = require('path');
    var file = path.join(require('os').tmpdir(), 'socialae-frame-' + Date.now() + '.png');
    setStatus('Salvo il fotogramma corrente…');
    AE.call('SAE_saveFrame', file)
      .then(function (res) {
        state.comp = { width: res.width, height: res.height };
        return waitForFile(file, 15000);
      })
      .then(function (f) {
        var old = state.frame;
        setFrame(f);
        renderPreview(false);
        setStatus('');
        if (old) { try { require('fs').unlinkSync(old); } catch (e) { /* file temporaneo */ } }
      })
      .catch(fail);
  }

  /* ---------- Avvio ---------- */

  function init() {
    var stored = load();

    state.custom = loadCustom();
    writeStyle(Object.assign({}, Presets.BASE, stored.style || {}));
    state.preset = stored.preset || (stored.style ? '' : 'classico');
    renderChips();
    var settings = Object.assign({ engine: 'openai' }, stored.settings || {});
    SETTING_KEYS.forEach(function (k) { if (settings[k] !== undefined) $(k).value = settings[k]; });
    state.words = stored.words || [];
    if (stored.comp) state.comp = stored.comp;

    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('is-active', t === tab); });
        document.querySelectorAll('.pane').forEach(function (p) {
          p.classList.toggle('is-active', p.id === 'pane-' + tab.dataset.tab);
        });
        if (tab.dataset.tab === 'style') renderPreview(false);
      });
    });

    function showEngine() {
      document.querySelectorAll('[data-engine]').forEach(function (el) {
        el.hidden = el.dataset.engine !== $('engine').value;
      });
    }
    showEngine();

    $('btn-preset-save').addEventListener('click', savePreset);
    $('preset-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') savePreset(); });
    $('btn-preset-delete').addEventListener('click', deletePreset);
    $('btn-preset-export').addEventListener('click', exportPresets);
    $('btn-preset-import').addEventListener('click', importPresets);
    $('btn-zoom').addEventListener('click', function () { state.zoom = !state.zoom; renderPreview(false); });
    $('btn-frame').addEventListener('click', grabFrame);
    $('btn-frame-clear').addEventListener('click', function () { setFrame(''); });

    // Anche 'change': nelle versioni di Chromium più vecchie le checkbox non emettono 'input'.
    function onStyleChange(e) {
      if (e.target.id === 'preset-name') return;
      state.preset = '';
      syncChips();
      syncRanges();
      if (e.target.id === 'font') updateFontNote();
      syncDisabled();
      var regroup = GROUPING_KEYS.concat(['textCase', 'stripPunctuation']).indexOf(e.target.id) >= 0;
      if (regroup) renderPages();
      renderPreview(regroup);
      save();
    }
    $('pane-style').addEventListener('input', onStyleChange);
    $('pane-style').addEventListener('change', onStyleChange);

    $('pane-settings').addEventListener('input', function (e) {
      if (e.target.id === 'engine') showEngine();
      save();
    });
    $('engine').addEventListener('change', showEngine);
    $('language').addEventListener('change', save);

    document.querySelectorAll('[data-browse]').forEach(function (b) {
      b.addEventListener('click', function () { browse(b.dataset.browse); });
    });

    $('btn-pick').addEventListener('click', pickLayer);
    $('btn-transcribe').addEventListener('click', transcribe);
    $('btn-generate').addEventListener('click', generate);
    $('btn-remove').addEventListener('click', removeCaptions);
    $('btn-save').addEventListener('click', saveTranscript);
    $('btn-load').addEventListener('click', loadTranscript);
    bindPageEditing();
    window.addEventListener('resize', function () { renderPreview(false); });

    renderPages();
    refreshButtons();
    renderPreview(true);
    requestAnimationFrame(tickPreview);
    loadFonts();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
