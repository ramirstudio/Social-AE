/*
 * Lato After Effects (ExtendScript, ES3).
 * Il pannello chiama queste funzioni con evalScript e riceve stringhe JSON.
 */

var SAE_TAG = 'SocialAE caption';

function SAE_quote(s) {
    return '"' + String(s)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t') + '"';
}

// ExtendScript di AE non ha JSON nativo in tutte le versioni.
function SAE_stringify(v) {
    if (v === null || v === undefined) return 'null';
    var t = typeof v;
    if (t === 'number') return isFinite(v) ? String(v) : 'null';
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'string') return SAE_quote(v);
    var parts = [];
    var i;
    if (v instanceof Array) {
        for (i = 0; i < v.length; i++) parts.push(SAE_stringify(v[i]));
        return '[' + parts.join(',') + ']';
    }
    for (i in v) {
        if (v.hasOwnProperty(i)) parts.push(SAE_quote(i) + ':' + SAE_stringify(v[i]));
    }
    return '{' + parts.join(',') + '}';
}

function SAE_error(msg) {
    return SAE_stringify({ ok: false, error: msg });
}

function SAE_activeComp() {
    var item = app.project.activeItem;
    return (item && item instanceof CompItem) ? item : null;
}

/* ---------- Sorgenti audio ---------- */

// Tempo interno del layer (tempo del file o della precomp) a un istante della comp che lo contiene.
function SAE_innerTime(layer, t) {
    if (layer.timeRemapEnabled) return layer.property('ADBE Time Remapping').valueAtTime(t, false);
    return (t - layer.startTime) * 100 / layer.stretch;
}

// Raccoglie le catene di layer [layer nella comp attiva, ..., layer con il file] che portano audio.
function SAE_collectChains(layer, chain, out, depth) {
    var hasAudio = false;
    try { hasAudio = layer.hasAudio && layer.audioEnabled; } catch (e) { /* layer senza audio (testo, forme, luci) */ }
    if (!hasAudio || depth > 12) return;
    var src = layer.source;
    if (src instanceof CompItem) {
        for (var i = 1; i <= src.numLayers; i++) {
            SAE_collectChains(src.layer(i), chain.concat([layer]), out, depth + 1);
        }
    } else if (src instanceof FootageItem && src.file) {
        out.push(chain.concat([layer]));
    }
}

// Tempo nel file per un istante della comp attiva, o null se in quel momento la clip non si vede/sente.
function SAE_chainTime(chain, t) {
    var cur = t;
    for (var i = 0; i < chain.length; i++) {
        var l = chain[i];
        if (cur < l.inPoint || cur >= l.outPoint) return null;
        cur = SAE_innerTime(l, cur);
    }
    var dur = chain[chain.length - 1].source.duration;
    if (cur < 0 || (dur > 0 && cur > dur)) return null;
    return cur;
}

// Toglie i punti allineati: per le clip senza remapping restano solo gli estremi.
function SAE_simplify(seg) {
    if (seg.length < 3) return seg;
    var out = [seg[0]];
    for (var i = 1; i < seg.length - 1; i++) {
        var a = out[out.length - 1];
        var b = seg[i];
        var c = seg[i + 1];
        var predicted = a[1] + (c[1] - a[1]) * (b[0] - a[0]) / (c[0] - a[0]);
        if (Math.abs(predicted - b[1]) > 0.002) out.push(b);
    }
    out.push(seg[seg.length - 1]);
    return out;
}

function SAE_sampleChain(comp, chain) {
    var top = chain[0];
    var step = comp.frameDuration;
    var t0 = Math.max(0, top.inPoint);
    var t1 = Math.min(comp.duration, top.outPoint);
    var segments = [];
    var cur = null;
    var frames = Math.ceil((t1 - t0) / step);
    for (var f = 0; f <= frames; f++) {
        // Indice intero: sommare step a ogni giro accumula errori e fa perdere il primo fotogramma.
        var tt = Math.min(t0 + f * step, t1 - 0.0005);
        var s = SAE_chainTime(chain, tt);
        if (s === null) {
            if (cur) segments.push(SAE_simplify(cur));
            cur = null;
        } else {
            if (!cur) cur = [];
            cur.push([Math.round(tt * 10000) / 10000, Math.round(s * 10000) / 10000]);
        }
    }
    if (cur) segments.push(SAE_simplify(cur));
    return segments;
}

/*
 * Tracce audio da trascrivere: i layer selezionati o, se non c'è selezione,
 * tutti i layer della comp. Le precomp vengono attraversate fino ai file.
 */
function SAE_getSources() {
    try {
        var comp = SAE_activeComp();
        if (!comp) return SAE_error('Apri una composizione.');
        var layers = [];
        var i;
        if (comp.selectedLayers.length) {
            for (i = 0; i < comp.selectedLayers.length; i++) layers.push(comp.selectedLayers[i]);
        } else {
            for (i = 1; i <= comp.numLayers; i++) layers.push(comp.layer(i));
        }
        var chains = [];
        for (i = 0; i < layers.length; i++) SAE_collectChains(layers[i], [], chains, 0);

        var tracks = [];
        var remap = false;
        for (i = 0; i < chains.length; i++) {
            var segs = SAE_sampleChain(comp, chains[i]);
            if (!segs.length) continue;
            var names = [];
            for (var k = 0; k < chains[i].length; k++) {
                names.push(chains[i][k].name);
                if (chains[i][k].timeRemapEnabled) remap = true;
            }
            var leaf = chains[i][chains[i].length - 1];
            tracks.push({ filePath: leaf.source.file.fsName, name: names.join(' > '), segments: segs });
        }
        if (!tracks.length) {
            return SAE_error(comp.selectedLayers.length
                ? 'Nei layer selezionati non c\'è audio attivo proveniente da un file.'
                : 'In questa composizione non c\'è audio attivo proveniente da un file.');
        }
        return SAE_stringify({
            ok: true,
            comp: { name: comp.name, width: comp.width, height: comp.height, duration: comp.duration },
            selection: comp.selectedLayers.length > 0,
            remap: remap,
            tracks: tracks
        });
    } catch (e) {
        return SAE_error(e.toString());
    }
}

// Salva come PNG il fotogramma sotto l'indicatore del tempo, per lo sfondo dell'anteprima.
// La scrittura del file avviene in background: il pannello aspetta che compaia.
function SAE_saveFrame(path) {
    try {
        var comp = SAE_activeComp();
        if (!comp) return SAE_error('Apri una composizione.');
        if (!comp.saveFrameToPng) return SAE_error('Questa versione di After Effects non sa salvare fotogrammi da script.');
        comp.saveFrameToPng(comp.time, new File(path));
        return SAE_stringify({ ok: true, width: comp.width, height: comp.height });
    } catch (e) {
        return SAE_error(e.toString());
    }
}

// app.fonts esiste da After Effects 24.0: prima di allora il pannello usa un campo libero.
function SAE_getFonts() {
    try {
        if (!app.fonts || !app.fonts.allFonts) return SAE_stringify({ ok: true, fonts: [] });
        var groups = app.fonts.allFonts;
        var list = [];
        for (var i = 0; i < groups.length; i++) {
            for (var j = 0; j < groups[i].length; j++) {
                var f = groups[i][j];
                list.push({ ps: f.postScriptName, family: f.familyName, style: f.styleName });
            }
        }
        return SAE_stringify({ ok: true, fonts: list });
    } catch (e) {
        return SAE_error(e.toString());
    }
}

function SAE_removeCaptionsIn(comp) {
    var removed = 0;
    for (var i = comp.numLayers; i >= 1; i--) {
        var l = comp.layer(i);
        if (l.comment === SAE_TAG) {
            l.remove();
            removed++;
        }
    }
    return removed;
}

function SAE_removeCaptions() {
    var comp = SAE_activeComp();
    if (!comp) return SAE_error('Nessuna composizione attiva.');
    app.beginUndoGroup('Social AE: rimuovi sottotitoli');
    var n = SAE_removeCaptionsIn(comp);
    app.endUndoGroup();
    return SAE_stringify({ ok: true, removed: n });
}

/* ---------- Animatori di testo ---------- */

function SAE_animators(layer) {
    return layer.property('ADBE Text Properties').property('ADBE Text Animators');
}

// Dopo ogni addProperty i riferimenti fratelli possono diventare invalidi:
// per questo si riprende sempre l'animatore partendo dal layer.
function SAE_addAnimator(layer, name) {
    var anim = SAE_animators(layer).addProperty('ADBE Text Animator');
    anim.name = name;
    return SAE_animators(layer).numProperties;
}

function SAE_anim(layer, idx) {
    return SAE_animators(layer).property(idx);
}

function SAE_addSelector(layer, idx) {
    SAE_anim(layer, idx).property('ADBE Text Selectors').addProperty('ADBE Text Selector');
    var sels = SAE_anim(layer, idx).property('ADBE Text Selectors');
    return sels.property(sels.numProperties);
}

// Selettore a indice basato sulle parole, guidato da un'espressione.
function SAE_indexSelector(sel, startExpr, endExpr, mode) {
    var adv = sel.property('ADBE Text Range Advanced');
    adv.property('ADBE Text Range Units').setValue(2);   // Indice
    adv.property('ADBE Text Range Type2').setValue(3);   // Basato su: Parole
    if (mode) adv.property('ADBE Text Selector Mode').setValue(mode);
    sel.property('ADBE Text Index Start').expression = startExpr;
    sel.property('ADBE Text Index End').expression = endExpr;
}

function SAE_addAnimProp(layer, idx, matchName, value) {
    SAE_anim(layer, idx).property('ADBE Text Animator Properties').addProperty(matchName);
    SAE_anim(layer, idx).property('ADBE Text Animator Properties').property(matchName).setValue(value);
}

// Espressione che trova la parola in corso dai tempi di inizio.
function SAE_wordIndexExpr(starts, tail) {
    var arr = [];
    for (var i = 0; i < starts.length; i++) arr.push(Math.round(starts[i] * 1000) / 1000);
    return 'var s=[' + arr.join(',') + '];var i=-1;' +
        'for(var k=0;k<s.length;k++){if(time>=s[k])i=k;}' + tail;
}

/* ---------- Creazione ---------- */

function SAE_setText(layer, text, st) {
    var prop = layer.property('ADBE Text Properties').property('ADBE Text Document');
    var doc = prop.value;
    try { doc.resetCharStyle(); doc.resetParagraphStyle(); } catch (e) { /* versioni vecchie */ }
    doc.text = text;
    var fontOk = SAE_fontExists(st.font);
    if (fontOk) {
        try { doc.font = st.font; } catch (e) { fontOk = false; }
    }
    doc.fontSize = st.fontSize;
    doc.applyFill = true;
    doc.fillColor = st.fillColor;
    doc.applyStroke = st.strokeWidth > 0;
    if (st.strokeWidth > 0) {
        doc.strokeColor = st.strokeColor;
        doc.strokeWidth = st.strokeWidth;
        doc.strokeOverFill = false;
    }
    doc.tracking = st.tracking;
    doc.justification = ParagraphJustification.CENTER_JUSTIFY;
    if (st.leading > 0) {
        doc.autoLeading = false;
        doc.leading = st.leading;
    }
    prop.setValue(doc);
    return fontOk;
}

function SAE_fontExists(ps) {
    if (!ps) return false;
    // Prima di AE 24 non c'è modo di verificarlo: si prova e basta.
    if (!app.fonts || !app.fonts.getFontsByPostScriptName) return true;
    return app.fonts.getFontsByPostScriptName(ps).length > 0;
}

/*
 * Misura il riquadro di ogni parola nello spazio del layer di testo.
 * After Effects non espone la posizione delle singole parole, quindi si
 * cambia temporaneamente il testo (allineato a sinistra) e si legge
 * sourceRectAtTime: la destra del prefisso fino alla parola meno la larghezza
 * della parola da sola dà il suo bordo sinistro. Poi si ricentra ogni riga.
 */
function SAE_measureWords(layer, page) {
    var prop = layer.property('ADBE Text Properties').property('ADBE Text Document');
    var t = layer.inPoint;
    var doc = prop.value;
    var fullText = doc.text;
    doc.justification = ParagraphJustification.LEFT_JUSTIFY;

    function rect(text) {
        doc.text = text;
        prop.setValue(doc);
        return layer.sourceRectAtTime(t, false);
    }

    var one = rect('H');
    var two = rect('H\rH');
    var lead = two.height - one.height;

    var raw = [];
    var top = Infinity;
    var bottom = -Infinity;
    for (var li = 0; li < page.lines.length; li++) {
        var words = page.lines[li];
        var lineRect = rect(words.join(' '));
        top = Math.min(top, lineRect.top);
        bottom = Math.max(bottom, lineRect.top + lineRect.height);
        var lineWidth = lineRect.left + lineRect.width;
        for (var k = 0; k < words.length; k++) {
            var pre = rect(words.slice(0, k + 1).join(' '));
            var right = pre.left + pre.width;
            var left = right - rect(words[k]).width;
            raw.push({ left: left - lineWidth / 2, right: right - lineWidth / 2, line: li });
        }
    }

    doc.text = fullText;
    doc.justification = ParagraphJustification.CENTER_JUSTIFY;
    prop.setValue(doc);

    var boxes = [];
    for (var i = 0; i < raw.length; i++) {
        var y0 = top + raw[i].line * lead;
        var y1 = bottom + raw[i].line * lead;
        boxes.push({
            center: [(raw[i].left + raw[i].right) / 2, (y0 + y1) / 2],
            size: [raw[i].right - raw[i].left, y1 - y0]
        });
    }
    return boxes;
}

// Espressione che passa da un valore al successivo quando cambia parola, con un breve scivolamento.
function SAE_stepExpr(starts, values) {
    var s = [];
    var v = [];
    for (var i = 0; i < starts.length; i++) {
        s.push(Math.round(starts[i] * 1000) / 1000);
        v.push('[' + Math.round(values[i][0] * 10) / 10 + ',' + Math.round(values[i][1] * 10) / 10 + ']');
    }
    return 'var s=[' + s.join(',') + '];var v=[' + v.join(',') + '];var i=0;' +
        'for(var k=0;k<s.length;k++){if(time>=s[k])i=k;}' +
        'var a=v[Math.max(i-1,0)];ease(time,s[i],s[i]+0.08,a,v[i])';
}

function SAE_buildBox(comp, textLayer, page, st, boxes) {
    var shape = comp.layers.addShape();
    shape.name = textLayer.name + ' riquadro';
    shape.comment = SAE_TAG;
    shape.moveAfter(textLayer);
    shape.inPoint = page.start;
    shape.outPoint = page.end;

    shape.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group');
    var vectors = function () {
        return shape.property('ADBE Root Vectors Group').property(1).property('ADBE Vectors Group');
    };
    vectors().addProperty('ADBE Vector Shape - Rect');
    vectors().addProperty('ADBE Vector Graphic - Fill');

    var grow = st.highlight ? st.highlightScale / 100 : 1;
    var centers = [];
    var sizes = [];
    for (var i = 0; i < boxes.length; i++) {
        centers.push(boxes[i].center);
        sizes.push([boxes[i].size[0] * grow + st.boxPadding * 2, boxes[i].size[1] * grow + st.boxPadding]);
    }
    var rectShape = vectors().property('ADBE Vector Shape - Rect');
    rectShape.property('ADBE Vector Rect Size').expression = SAE_stepExpr(page.starts, sizes);
    rectShape.property('ADBE Vector Rect Position').expression = SAE_stepExpr(page.starts, centers);
    rectShape.property('ADBE Vector Rect Roundness').setValue(st.boxRadius);

    var fill = vectors().property('ADBE Vector Graphic - Fill');
    fill.property('ADBE Vector Fill Color').setValue(st.boxColor.concat([1]));
    fill.property('ADBE Vector Fill Opacity').setValue(st.boxOpacity);

    // Imparentato al testo: le coordinate sono quelle del layer di testo e segue anche il rimbalzo.
    shape.parent = textLayer;
    var tr = shape.property('ADBE Transform Group');
    tr.property('ADBE Anchor Point').setValue([0, 0]);
    tr.property('ADBE Position').setValue([0, 0]);
    tr.property('ADBE Scale').setValue([100, 100]);
    tr.property('ADBE Rotate Z').setValue(0);
}

function SAE_ease(n, influence) {
    var arr = [];
    for (var i = 0; i < n; i++) arr.push(new KeyframeEase(0, influence));
    return arr;
}

function SAE_buildCaption(comp, page, st, number) {
    var layer = comp.layers.addText(page.text);
    layer.name = 'Caption ' + (number < 10 ? '00' : number < 100 ? '0' : '') + number;
    layer.comment = SAE_TAG;
    var fontOk = SAE_setText(layer, page.text, st);

    layer.inPoint = page.start;
    layer.outPoint = page.end;

    // Il riquadro va misurato prima di aggiungere animatori ed effetti.
    var boxes = st.box ? SAE_measureWords(layer, page) : null;

    // Punto di ancoraggio fisso al centro del testo: calcolato ora, così la
    // scala della parola attiva non fa tremare il blocco.
    var r = layer.sourceRectAtTime(layer.inPoint, false);
    var tr = layer.property('ADBE Transform Group');
    tr.property('ADBE Anchor Point').setValue([r.left + r.width / 2, r.top + r.height / 2]);
    tr.property('ADBE Position').setValue([comp.width / 2, comp.height * st.posY]);

    // Scala di ogni parola attorno al proprio centro, non per carattere.
    var more = layer.property('ADBE Text Properties').property('ADBE Text More Options');
    more.property('ADBE Text Anchor Point Option').setValue(2);
    more.property('ADBE Text Anchor Point Align').setValue([0, -35]);

    var n = page.starts.length;
    var idx, sel;

    if (st.reveal) {
        idx = SAE_addAnimator(layer, 'Comparsa');
        SAE_addAnimProp(layer, idx, 'ADBE Text Opacity', 0);
        sel = SAE_addSelector(layer, idx);
        SAE_indexSelector(sel,
            SAE_wordIndexExpr(page.starts, 'i+1'),
            SAE_wordIndexExpr(page.starts, n + ''));
    }

    if (st.dimOthers) {
        idx = SAE_addAnimator(layer, 'Attenua');
        SAE_addAnimProp(layer, idx, 'ADBE Text Opacity', st.dimOpacity);
        SAE_addSelector(layer, idx); // il primo selettore prende tutto il testo
        sel = SAE_addSelector(layer, idx);
        SAE_indexSelector(sel,
            SAE_wordIndexExpr(page.starts, 'Math.max(i,0)'),
            SAE_wordIndexExpr(page.starts, 'i<0?0:i+1'),
            2); // Sottrai: la parola in corso resta piena
    }

    if (st.highlight) {
        idx = SAE_addAnimator(layer, 'Parola attiva');
        SAE_addAnimProp(layer, idx, 'ADBE Text Fill Color', st.highlightColor.concat([1])); // le proprietà colore sono RGBA
        if (st.highlightScale !== 100) {
            SAE_addAnimProp(layer, idx, 'ADBE Text Scale 3D', [st.highlightScale, st.highlightScale, 100]);
        }
        sel = SAE_addSelector(layer, idx);
        SAE_indexSelector(sel,
            SAE_wordIndexExpr(page.starts, 'Math.max(i,0)'),
            SAE_wordIndexExpr(page.starts, 'i<0?0:i+1'));
    }

    if (boxes) SAE_buildBox(comp, layer, page, st, boxes);

    if (st.popIn) {
        // Riferimento ripreso dal layer: gli addProperty sugli animatori possono invalidare quelli vecchi.
        var scale = layer.property('ADBE Transform Group').property('ADBE Scale');
        var t0 = page.start;
        var t1 = Math.min(page.start + 0.1, page.end);
        scale.setValueAtTime(t0, [st.popFrom, st.popFrom, 100]);
        scale.setValueAtTime(t1, [100, 100, 100]);
        for (var k = 1; k <= scale.numKeys; k++) {
            scale.setTemporalEaseAtKey(k, SAE_ease(3, 33), SAE_ease(3, 75));
        }
    }

    if (st.shadow) {
        var fx = layer.property('ADBE Effect Parade').addProperty('ADBE Drop Shadow');
        fx.property('ADBE Drop Shadow-0004').setValue(st.shadowDistance);
        fx.property('ADBE Drop Shadow-0005').setValue(st.shadowSoftness);
    }

    return fontOk;
}

/*
 * payload: { pages: [{ text, starts, start, end }], style: {...}, replace }
 * Tempi già in secondi di composizione.
 */
function SAE_createCaptions(payload) {
    var comp = SAE_activeComp();
    if (!comp) return SAE_error('Nessuna composizione attiva.');
    app.beginUndoGroup('Social AE: crea sottotitoli');
    try {
        if (payload.replace) SAE_removeCaptionsIn(comp);
        var st = payload.style;
        var made = 0;
        var fontMissing = false;
        for (var i = 0; i < payload.pages.length; i++) {
            var p = payload.pages[i];
            if (p.end <= 0 || p.start >= comp.duration) continue;
            if (!SAE_buildCaption(comp, p, st, i + 1)) fontMissing = true;
            made++;
        }
        app.endUndoGroup();
        return SAE_stringify({ ok: true, created: made, fontMissing: fontMissing });
    } catch (e) {
        app.endUndoGroup();
        return SAE_error('Riga ' + e.line + ': ' + e.toString());
    }
}
