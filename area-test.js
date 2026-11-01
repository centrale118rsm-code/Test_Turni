/*
 * AREA TEST — da caricare per primo in ogni pagina della versione di prova.
 *  1. Memoria del dispositivo separata: le app dei turni stanno tutte su
 *     centrale118rsm-code.github.io e condividerebbero localStorage; qui ogni
 *     chiave prende il prefisso "test26_" così la prova non tocca le app vere.
 *     (Le chiavi "TESTFB:" sono il database finto di firebase-mock.js.)
 *  2. Bandella bianca e rossa "AREA TEST" attorno a tutto il programma.
 *     Toccando la scritta in alto si possono azzerare i dati di prova.
 */
(function () {
    'use strict';
    // ── 1. memoria separata ────────────────────────────────────────────
    if (!window.__testStorageShim) {
        window.__testStorageShim = true;
        try {
            var P = 'test26_', ls = window.localStorage, ss = window.sessionStorage, S = Storage.prototype;
            var g = S.getItem, s = S.setItem, r = S.removeItem;
            var k = function (st, key) { key = String(key); return (st === ls || st === ss) && key.indexOf('TESTFB:') !== 0 && key.indexOf(P) !== 0 ? P + key : key; };
            S.getItem = function (key) { return g.call(this, k(this, key)); };
            S.setItem = function (key, v) { return s.call(this, k(this, key), v); };
            S.removeItem = function (key) { return r.call(this, k(this, key)); };
        } catch (e) {}
    }

    // ── 2. bandella ────────────────────────────────────────────────────
    var CSS = [
        '#area-test-frame{position:fixed;inset:0;pointer-events:none;z-index:2147483646;}',
        '#area-test-frame .at-tape{position:absolute;background:repeating-linear-gradient(-45deg,#e10600 0 14px,#ffffff 14px 28px);box-shadow:0 0 0 1px rgba(0,0,0,.25),0 1px 4px rgba(0,0,0,.35);}',
        '#area-test-frame .at-top{top:0;left:0;right:0;height:calc(env(safe-area-inset-top,0px) + 20px);}',
        '#area-test-frame .at-bottom{bottom:0;left:0;right:0;height:calc(env(safe-area-inset-bottom,0px) + 8px);}',
        '#area-test-frame .at-left{top:0;bottom:0;left:0;width:8px;}',
        '#area-test-frame .at-right{top:0;bottom:0;right:0;width:8px;}',
        '#area-test-label{position:fixed;top:calc(env(safe-area-inset-top,0px) + 1px);left:50%;transform:translateX(-50%);z-index:2147483647;',
        'pointer-events:auto;cursor:pointer;background:#fff;color:#e10600;border:2px solid #e10600;border-radius:4px;padding:0 10px;height:18px;line-height:14px;',
        'font:900 12px/14px "Plus Jakarta Sans",Arial,Helvetica,sans-serif;letter-spacing:.18em;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.4);-webkit-user-select:none;user-select:none;}',
        '#area-test-label small{font-weight:700;letter-spacing:.04em;color:#7f1d1d;margin-left:6px;}',
        '@media print{#area-test-frame,#area-test-label{display:none!important;}}'
    ].join('');

    function mount() {
        if (document.getElementById('area-test-frame')) return;
        var st = document.createElement('style'); st.id = 'area-test-style'; st.textContent = CSS;
        (document.head || document.documentElement).appendChild(st);
        var f = document.createElement('div'); f.id = 'area-test-frame'; f.setAttribute('aria-hidden', 'true');
        ['at-top', 'at-bottom', 'at-left', 'at-right'].forEach(function (c) { var d = document.createElement('div'); d.className = 'at-tape ' + c; f.appendChild(d); });
        var lab = document.createElement('div'); lab.id = 'area-test-label'; lab.setAttribute('role', 'button');
        lab.title = 'Versione di prova scollegata da Firebase. Tocca per azzerare i dati di prova.';
        lab.innerHTML = '⚠ AREA TEST<small>dati finti</small>';
        lab.addEventListener('click', function (ev) {
            ev.preventDefault(); ev.stopPropagation();
            var n = window.__testFirebase ? window.__testFirebase.count() : 0;
            if (confirm('AREA TEST\n\nQuesta versione NON è collegata a Firebase: tutto quello che fai resta solo in questo browser.\n\nVuoi AZZERARE i dati di prova (' + n + ' documenti) e ricaricare?')) {
                try { if (window.__testFirebase) window.__testFirebase.reset(); } catch (e) {}
                location.reload();
            }
        });
        document.body.appendChild(f);
        document.body.appendChild(lab);
        if (document.title.indexOf('TEST') !== 0) document.title = 'TEST · ' + document.title;
    }
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
