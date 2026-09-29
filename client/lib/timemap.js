/*
 * Corrispondenza tra tempo del file sorgente e tempo di composizione.
 *
 * After Effects campiona, fotogramma per fotogramma, a quale istante del file
 * corrisponde ogni istante della composizione attraversando precomp, stretch e
 * remapping. Ogni traccia arriva come elenco di segmenti continui di coppie
 * [tempoComp, tempoSorgente]; qui si fa il percorso inverso per le parole.
 */
(function (root, factory) {
  var api = factory();
  if (typeof window !== 'undefined') window.TimeMap = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(this, function () {
  'use strict';

  // Primo istante di composizione in cui si vede il tempo sorgente ts, o null.
  function srcToComp(segments, ts) {
    var best = null;
    segments.forEach(function (seg) {
      if (seg.length === 1) {
        if (Math.abs(seg[0][1] - ts) < 0.02 && (best === null || seg[0][0] < best)) best = seg[0][0];
        return;
      }
      for (var i = 0; i < seg.length - 1; i++) {
        var a = seg[i];
        var b = seg[i + 1];
        var lo = Math.min(a[1], b[1]);
        var hi = Math.max(a[1], b[1]);
        if (ts < lo || ts > hi) continue;
        var t = b[1] === a[1] ? a[0] : a[0] + (ts - a[1]) / (b[1] - a[1]) * (b[0] - a[0]);
        if (best === null || t < best) best = t;
        break; // dentro un segmento conta il primo passaggio
      }
    });
    return best;
  }

  function srcRange(seg) {
    var lo = Infinity;
    var hi = -Infinity;
    seg.forEach(function (p) {
      lo = Math.min(lo, p[1]);
      hi = Math.max(hi, p[1]);
    });
    return [lo, hi];
  }

  /*
   * Raggruppa le tracce per file e unisce gli intervalli vicini, così uno
   * stesso file tagliato in più clip viene trascritto una volta sola.
   * Restituisce [{ filePath, srcIn, srcOut, tracks }].
   */
  function planChunks(tracks, pad, joinGap) {
    pad = pad === undefined ? 0.5 : pad;
    joinGap = joinGap === undefined ? 10 : joinGap;
    var byFile = {};
    tracks.forEach(function (tr) {
      tr.segments.forEach(function (seg) {
        var r = srcRange(seg);
        (byFile[tr.filePath] = byFile[tr.filePath] || []).push({
          lo: Math.max(0, r[0] - pad), hi: r[1] + pad, track: tr
        });
      });
    });
    var chunks = [];
    Object.keys(byFile).forEach(function (file) {
      var parts = byFile[file].sort(function (a, b) { return a.lo - b.lo; });
      var cur = null;
      parts.forEach(function (p) {
        if (cur && p.lo - cur.srcOut <= joinGap) {
          cur.srcOut = Math.max(cur.srcOut, p.hi);
          if (cur.tracks.indexOf(p.track) < 0) cur.tracks.push(p.track);
        } else {
          cur = { filePath: file, srcIn: p.lo, srcOut: p.hi, tracks: [p.track] };
          chunks.push(cur);
        }
      });
    });
    return chunks;
  }

  // Porta le parole (tempi sorgente) in tempo di composizione attraverso una traccia.
  function mapWords(words, track) {
    var out = [];
    words.forEach(function (w) {
      var start = srcToComp(track.segments, w.start);
      if (start === null) start = srcToComp(track.segments, (w.start + w.end) / 2);
      if (start === null) return; // parola tagliata fuori dal montaggio
      var end = srcToComp(track.segments, w.end);
      var dur = w.end - w.start;
      if (end === null || end <= start || end - start > dur * 4 + 0.5) end = start + dur;
      out.push({ text: w.text, start: start, end: end });
    });
    return out;
  }

  function norm(s) {
    return String(s).toLowerCase().replace(/[^0-9a-zà-ÿ]/g, '');
  }

  /*
   * Ordina e toglie i doppioni: capita quando lo stesso parlato è su due
   * tracce (audio camera + microfono) o due clip si sovrappongono.
   */
  function mergeWords(lists) {
    var all = [].concat.apply([], lists).sort(function (a, b) { return a.start - b.start; });
    var kept = [];
    all.forEach(function (w) {
      for (var i = kept.length - 1; i >= 0 && w.start - kept[i].start < 0.3; i--) {
        if (norm(kept[i].text) === norm(w.text)) return;
      }
      kept.push(w);
    });
    return kept;
  }

  return {
    srcToComp: srcToComp,
    planChunks: planChunks,
    mapWords: mapWords,
    mergeWords: mergeWords
  };
});
