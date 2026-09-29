/*
 * Estrazione audio (ffmpeg) e trascrizione con tempi per parola.
 * Due motori: API OpenAI Whisper oppure whisper.cpp in locale.
 * Gira nel contesto Node del pannello CEP (--enable-nodejs --mixed-context).
 */
(function (root, factory) {
  // Nel pannello CEP (mixed context) esistono sia window sia module: esponiamo su entrambi.
  var api = factory();
  if (typeof window !== 'undefined') window.Transcribe = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(this, function () {
  'use strict';

  var nodeRequire = typeof require === 'function' ? require : (typeof window !== 'undefined' && window.cep_node ? window.cep_node.require : null);

  function node(name) {
    if (!nodeRequire) throw new Error('Node.js non disponibile nel pannello: controlla il manifest (--enable-nodejs).');
    return nodeRequire(name);
  }

  // Le app macOS non ereditano il PATH della shell: cerchiamo anche nei posti soliti.
  var EXTRA_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', 'C:\\ffmpeg\\bin', 'C:\\Program Files\\ffmpeg\\bin'];

  function findBinary(name, custom) {
    var fs = node('fs');
    var path = node('path');
    if (custom) {
      if (fs.existsSync(custom)) return custom;
      throw new Error('Eseguibile non trovato: ' + custom);
    }
    var isWin = process.platform === 'win32';
    var exe = isWin ? name + '.exe' : name;
    var dirs = (process.env.PATH || '').split(path.delimiter).concat(EXTRA_DIRS);
    for (var i = 0; i < dirs.length; i++) {
      if (!dirs[i]) continue;
      var p = path.join(dirs[i], exe);
      if (fs.existsSync(p)) return p;
    }
    throw new Error(name + ' non trovato. Installalo o indica il percorso nelle impostazioni.');
  }

  function run(bin, args) {
    var cp = node('child_process');
    return new Promise(function (resolve, reject) {
      cp.execFile(bin, args, { maxBuffer: 64 * 1024 * 1024 }, function (err, stdout, stderr) {
        if (err) {
          var tail = String(stderr || err.message).split('\n').slice(-6).join('\n');
          reject(new Error(bin + ' ha restituito un errore:\n' + tail));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  function tempFile(ext) {
    var os = node('os');
    var path = node('path');
    return path.join(os.tmpdir(), 'socialae-' + Date.now() + '.' + ext);
  }

  /*
   * Estrae l'audio mono a 16 kHz. format 'mp3' per l'API (limite 25 MB),
   * 'wav' per whisper.cpp che accetta solo PCM 16 kHz.
   */
  function extractAudio(opts) {
    var out = tempFile(opts.format);
    var args = ['-y', '-hide_banner', '-loglevel', 'error'];
    if (opts.start > 0) args.push('-ss', opts.start.toFixed(3));
    args.push('-i', opts.input);
    if (opts.duration > 0) args.push('-t', opts.duration.toFixed(3));
    args.push('-vn', '-ac', '1', '-ar', '16000');
    if (opts.format === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', '48k');
    else args.push('-c:a', 'pcm_s16le');
    args.push(out);
    return run(opts.ffmpeg, args).then(function () { return out; });
  }

  function parseOpenAIResponse(json) {
    var words = (json.words || []).map(function (w) {
      return { text: String(w.word).trim(), start: w.start, end: w.end };
    }).filter(function (w) { return w.text; });
    return { words: words, text: json.text || '' };
  }

  function transcribeOpenAI(opts) {
    var fs = node('fs');
    var size = fs.statSync(opts.audioPath).size;
    if (size > 25 * 1024 * 1024) {
      return Promise.reject(new Error('Audio oltre i 25 MB accettati dall\'API: accorcia il layer o usa whisper.cpp.'));
    }
    var form = new FormData();
    form.append('file', new Blob([fs.readFileSync(opts.audioPath)], { type: 'audio/mpeg' }), 'audio.mp3');
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');
    if (opts.language) form.append('language', opts.language);
    if (opts.prompt) form.append('prompt', opts.prompt);

    return fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + opts.apiKey },
      body: form
    }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok) throw new Error('OpenAI: ' + ((json.error && json.error.message) || res.status));
        return parseOpenAIResponse(json);
      });
    });
  }

  /*
   * Output JSON di whisper.cpp con --max-len 1 --split-on-word: ogni segmento
   * è una parola. Un segmento che non inizia con uno spazio è la continuazione
   * della parola precedente (succede con token spezzati o punteggiatura).
   */
  function parseWhisperCppJson(json) {
    var words = [];
    (json.transcription || []).forEach(function (seg) {
      var raw = seg.text || '';
      var text = raw.trim();
      if (!text || /^\[.*\]$/.test(text)) return;
      var start = seg.offsets.from / 1000;
      var end = seg.offsets.to / 1000;
      var prev = words[words.length - 1];
      if (prev && !/^\s/.test(raw)) {
        prev.text += text;
        prev.end = end;
      } else {
        words.push({ text: text, start: start, end: end });
      }
    });
    return { words: words, text: words.map(function (w) { return w.text; }).join(' ') };
  }

  function transcribeWhisperCpp(opts) {
    var fs = node('fs');
    var outBase = tempFile('wcpp');
    var args = ['-m', opts.model, '-f', opts.audioPath, '-oj', '-of', outBase, '-ml', '1', '-sow', '-np'];
    args.push('-l', opts.language || 'auto');
    if (opts.prompt) args.push('--prompt', opts.prompt);
    return run(opts.bin, args).then(function () {
      var json = JSON.parse(fs.readFileSync(outBase + '.json', 'utf8'));
      try { fs.unlinkSync(outBase + '.json'); } catch (e) { /* file temporaneo */ }
      return parseWhisperCppJson(json);
    });
  }

  /*
   * Flusso completo. source: { filePath, srcIn, srcOut } in secondi del media.
   * Restituisce parole con tempi nel tempo del media sorgente.
   */
  function transcribe(source, settings, onStatus) {
    var status = onStatus || function () {};
    var ffmpeg = findBinary('ffmpeg', settings.ffmpegPath);
    var useApi = settings.engine === 'openai';
    if (useApi && !settings.apiKey) return Promise.reject(new Error('Inserisci la chiave API OpenAI nelle impostazioni.'));
    if (!useApi && (!settings.whisperPath || !settings.whisperModel)) {
      return Promise.reject(new Error('Indica eseguibile e modello di whisper.cpp nelle impostazioni.'));
    }

    status('Estraggo l\'audio…');
    var audioPath;
    return extractAudio({
      ffmpeg: ffmpeg,
      input: source.filePath,
      start: source.srcIn,
      duration: source.srcOut - source.srcIn,
      format: useApi ? 'mp3' : 'wav'
    }).then(function (p) {
      audioPath = p;
      status(useApi ? 'Trascrivo con OpenAI Whisper…' : 'Trascrivo con whisper.cpp…');
      var common = { audioPath: p, language: settings.language, prompt: settings.prompt };
      return useApi
        ? transcribeOpenAI(Object.assign(common, { apiKey: settings.apiKey }))
        : transcribeWhisperCpp(Object.assign(common, { bin: settings.whisperPath, model: settings.whisperModel }));
    }).then(function (result) {
      try { node('fs').unlinkSync(audioPath); } catch (e) { /* file temporaneo */ }
      return {
        words: result.words.map(function (w) {
          return { text: w.text, start: w.start + source.srcIn, end: w.end + source.srcIn };
        }),
        text: result.text
      };
    });
  }

  return {
    findBinary: findBinary,
    extractAudio: extractAudio,
    parseOpenAIResponse: parseOpenAIResponse,
    parseWhisperCppJson: parseWhisperCppJson,
    transcribe: transcribe
  };
});
