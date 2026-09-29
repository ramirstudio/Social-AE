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

function SAE_getSelection() {
    try {
        var comp = SAE_activeComp();
        if (!comp) return SAE_error('Apri una composizione e seleziona il layer con il parlato.');
        if (comp.selectedLayers.length === 0) return SAE_error('Seleziona nella timeline il layer video o audio da trascrivere.');
        var layer = comp.selectedLayers[0];
        var src = layer.source;
        if (!src || !(src instanceof FootageItem) || !src.file) {
            return SAE_error('Il layer "' + layer.name + '" non è un file video/audio. Per le precomp seleziona il layer originale.');
        }
        if (!src.hasAudio) return SAE_error('Il file "' + src.name + '" non ha una traccia audio.');
        return SAE_stringify({
            ok: true,
            comp: {
                name: comp.name,
                width: comp.width,
                height: comp.height,
                duration: comp.duration,
                frameRate: comp.frameRate
            },
            layer: {
                name: layer.name,
                index: layer.index,
                filePath: src.file.fsName,
                startTime: layer.startTime,
                inPoint: layer.inPoint,
                outPoint: layer.outPoint,
                stretch: layer.stretch
            }
        });
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

    var tr = layer.property('ADBE Transform Group');
    tr.property('ADBE Anchor Point').expression =
        'var r=sourceRectAtTime(time,false);[r.left+r.width/2,r.top+r.height/2]';
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
