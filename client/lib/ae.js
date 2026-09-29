/*
 * Ponte minimo verso ExtendScript, senza dipendere da CSInterface.js.
 */
(function () {
  'use strict';

  function evalHost(script) {
    return new Promise(function (resolve, reject) {
      if (!window.__adobe_cep__) {
        reject(new Error('Il pannello va aperto dentro After Effects.'));
        return;
      }
      window.__adobe_cep__.evalScript(script, function (res) {
        if (res === 'EvalScript error.') {
          reject(new Error('Errore nello script di After Effects.'));
          return;
        }
        var data;
        try { data = JSON.parse(res); } catch (e) { reject(new Error(String(res))); return; }
        if (data && data.ok === false) reject(new Error(data.error));
        else resolve(data);
      });
    });
  }

  // I separatori di riga Unicode rompono le stringhe letterali in ExtendScript (ES3).
  function literal(obj) {
    return JSON.stringify(obj).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }

  function call(fn, arg) {
    return evalHost(fn + '(' + (arg === undefined ? '' : literal(arg)) + ')');
  }

  window.AE = { call: call };
})();
