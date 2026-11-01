/*
 * ══════════════════════════════════════════════════════════════════════════
 *  AREA TEST — GENERAZIONE TURNI AUTOMATICA + RICHIESTE DAL PORTALE (finto)
 * ══════════════════════════════════════════════════════════════════════════
 *  Due sezioni nuove dell'Area coordinatore, solo nella versione di prova:
 *   • "Generazione turni": crea l'anno scelto seguendo regole fisse (scritte
 *     anche nella finestra) e parte dai turni già compilati nel calendario.
 *   • "Richieste dal portale": le richieste mandate da portale-richieste.html
 *     (copia finta del portale Richieste A.S. 118) arrivano qui e si gestiscono
 *     a mano o in automatico; in automatico il generatore trova chi copre
 *     l'assenza e nel calendario generato compare "copertura turno di …".
 *  Tutto resta nel Firebase finto (firebase-mock.js, solo nel browser):
 *  il calendario vero dell'app non viene toccato.
 *
 *  Il motore (GTEngine) è indipendente dall'app: riceve i turni già scritti e
 *  restituisce il piano dell'anno. La parte UI lo collega alla console.
 * ══════════════════════════════════════════════════════════════════════════
 */
(function () {
    'use strict';

    // ═══════════════════════ MOTORE ═══════════════════════
    var CYCLE = ['P', 'M', 'N', 'S', 'R'];
    var WORK = { M: 1, P: 1, N: 1, S: 1, 'M+N': 1, m: 1, p: 1 };
    var REST = { R: 1, r: 1 };
    var MINUTES = { M: 405, P: 445, N: 255, S: 440, 'M+N': 660 };
    var MODELS = {
        '7h12': { label: '7 h 12 al giorno', rests: 2, dayMin: 432, workDays: 5, m: '06:30–13:42', p: '13:15–20:27', contractDow: [1, 2, 3, 4, 5] },
        '6h': { label: '6 h al giorno', rests: 1, dayMin: 360, workDays: 6, m: '07:00–13:00', p: '13:00–19:00', contractDow: [1, 2, 3, 4, 5, 6] }
    };
    var WEEK_MIN = 2160;   // 36 h

    function pad(n) { return String(n).padStart(2, '0'); }
    function isoOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function dateOf(iso) { var p = iso.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 12); }
    function addDays(iso, n) { var d = dateOf(iso); d.setDate(d.getDate() + n); return isoOf(d); }
    function dow(iso) { return dateOf(iso).getDay(); }
    function diffDays(a, b) { return Math.round((dateOf(a) - dateOf(b)) / 86400000); }
    function mondayOf(iso) { return addDays(iso, -((dow(iso) + 6) % 7)); }
    function codeMinutes(v, model) { if (v === 'm' || v === 'p') return MODELS[model].dayMin; return MINUTES[v] || 0; }
    function isM(v) { return v === 'M' || v === 'm' || v === 'M+N'; }
    function isP(v) { return v === 'P' || v === 'p'; }
    function isN(v) { return v === 'N' || v === 'M+N'; }

    var DEFAULT_OPTS = {
        model: '7h12', nights: 1, covM: 2, covP: 2, repGapDays: 4,
        rules: { eqOp: true, eqRep: true, model: true, weekendRest: true, mBeforeRest: true, blocks: true, repGap: true, eqFest: true }
    };

    /*
     * input = {
     *   year, ops:[{id, name}], opts,
     *   hist: { iso: { id: {v, sub} } }   turni già scritti (anche prima dell'anno)
     *   histRep: { iso: id }              reperibilità già scritte
     *   holidays: { 'mese0-giorno': nome } festivi dell'anno
     *   extraAbs: [{id, iso, sub, reqId}] assenze approvate dal portale
     * }
     */
    function generate(input) {
        var Y = input.year, ops = input.ops, opts = mergeOpts(input.opts), R = opts.rules, model = MODELS[opts.model] || MODELS['7h12'];
        var ids = ops.map(function (o) { return o.id; }), nameOf = {};
        ops.forEach(function (o) { nameOf[o.id] = o.name; });
        var days = [], first = Y + '-01-01', last = Y + '-12-31';
        for (var d = first; d <= last; d = addDays(d, 1)) days.push(d);
        var dayIdx = {}; days.forEach(function (x, i) { dayIdx[x] = i; });
        var hol = input.holidays || {};
        function fest(iso) { var dt = dateOf(iso); return dt.getDay() === 0 || !!hol[dt.getMonth() + '-' + dt.getDate()]; }
        var hist = input.hist || {};

        // ── griglia dell'anno: le caselle già scritte restano com'erano ──
        var G = {}, issues = [], covers = [];
        days.forEach(function (iso) {
            G[iso] = {};
            ids.forEach(function (id) {
                var h = hist[iso] && hist[iso][id];
                if (h && (h.v || h.sub)) G[iso][id] = { v: h.sub ? '' : h.v, sub: h.sub || '', fixed: true };
            });
        });
        (input.extraAbs || []).forEach(function (a) {
            if (!G[a.iso] || ids.indexOf(a.id) < 0) return;
            G[a.iso][a.id] = { v: '', sub: a.sub, fixed: true, req: a.reqId || '' };
        });
        function cell(iso, id) {
            if (G[iso]) return G[iso][id] || null;
            var h = hist[iso] && hist[iso][id];
            return h && (h.v || h.sub) ? { v: h.sub ? '' : h.v, sub: h.sub || '', fixed: true } : null;
        }
        function vOf(iso, id) { var c = cell(iso, id); return c ? c.v : ''; }
        function isAbs(iso, id) { var c = cell(iso, id); return !!(c && c.sub); }
        function empty(iso, id) { return !!G[iso] && !G[iso][id]; }
        function put(iso, id, v, extra) { if (!G[iso]) return; G[iso][id] = Object.assign({ v: v, sub: '', gen: true }, extra || {}); }

        // ── 1. fin dove arrivano i turnisti già scritti ──
        function cycleCount(iso) { var n = 0; ids.forEach(function (id) { var v = vOf(iso, id); if (CYCLE.indexOf(v) >= 0) n++; }); return n; }
        var X = first;
        while (X <= last && cycleCount(X) >= 3) X = addDays(X, 1);

        // ── 2. chi è turnista e in che posizione del ciclo il giorno X ──
        var phase = {};
        ids.forEach(function (id) {
            var votes = [0, 0, 0, 0, 0], recentTurn = false;
            for (var k = 1; k <= 21; k++) {
                var iso = addDays(X, -k), v = vOf(iso, id), p = CYCLE.indexOf(v);
                if (k <= 10 && (v === 'N' || v === 'S')) recentTurn = true;
                if (p >= 0) votes[(p + k) % 5] += Math.pow(2, -k / 3);
            }
            if (!recentTurn) return;
            var best = Math.max.apply(null, votes); if (best <= 0) return;
            phase[id] = { pos: votes.indexOf(best), score: best };
        });
        var owner = [null, null, null, null, null];
        Object.keys(phase).sort(function (a, b) { return phase[b].score - phase[a].score; }).forEach(function (id) {
            if (owner[phase[id].pos] === null) owner[phase[id].pos] = id;
        });
        // inizio del blocco in turno (per i 5 settimane) e ultimo giorno in turno (per la coda dei diurnisti)
        var turnStart = {}, lastTurn = {}, turnDays = {}, diurnoDays = {};
        ids.forEach(function (id) { lastTurn[id] = '0000-01-01'; turnDays[id] = 0; diurnoDays[id] = 0; });
        ids.forEach(function (id) {
            for (var k = 1; k <= 140; k++) { var v = vOf(addDays(X, -k), id); if (v === 'N' || v === 'S') { lastTurn[id] = addDays(X, -k); break; } }
        });
        var freshStart = owner.every(function (o) { return o === null; });
        owner.forEach(function (id, pos) {
            if (id === null) return;
            var s = X;
            for (var k = 1; k <= 70; k++) { var iso = addDays(X, -k), v = vOf(iso, id); if (CYCLE.indexOf(v) >= 0 || v === 'M+N' || isAbs(iso, id)) s = iso; else if (v) break; }
            turnStart[id] = s;
        });
        function queue(at, exclude) {
            return ids.filter(function (id) { return owner.indexOf(id) < 0 && exclude.indexOf(id) < 0; }).sort(function (a, b) {
                var absA = absIn(a, at, 35), absB = absIn(b, at, 35);
                if ((absA > 17) !== (absB > 17)) return absA > 17 ? 1 : -1;            // chi è assente per metà blocco aspetta
                if (lastTurn[a] !== lastTurn[b]) return lastTurn[a] < lastTurn[b] ? -1 : 1;   // da più tempo fuori turno
                if (R.eqOp && turnDays[a] !== turnDays[b]) return turnDays[a] - turnDays[b];
                return ids.indexOf(a) - ids.indexOf(b);
            });
        }
        function absIn(id, from, n) { var c = 0; for (var k = 0; k < n; k++) if (isAbs(addDays(from, k), id)) c++; return c; }
        owner.forEach(function (id, pos) {   // posizioni vuote (anno senza turni): entra chi è in testa alla coda
            if (id !== null) return;
            var q = queue(X, []); if (!q.length) return;
            owner[pos] = q[0]; turnStart[q[0]] = freshStart ? addDays(X, -35) : X;
        });

        // ── 3. turnisti dal giorno X: ciclo P › M › N › S › R, cambio blocco il lunedì del P dopo 5 settimane ──
        var role = {}, swaps = [];
        days.forEach(function (iso) {
            role[iso] = {};
            if (iso < X) {   // giorni già compilati: turnista chi ha notti o smonti vicini
                ids.forEach(function (id) {
                    var own = vOf(iso, id), t = false;
                    if (CYCLE.indexOf(own) >= 0) { for (var k = -3; k <= 3 && !t; k++) { var v = vOf(addDays(iso, k), id); if (v === 'N' || v === 'S') t = true; } }
                    else if (isAbs(iso, id)) { for (var k2 = -3; k2 <= 3 && !t; k2++) { var v2 = vOf(addDays(iso, k2), id); if (v2 === 'N' || v2 === 'S') t = true; } }
                    role[iso][id] = t ? 't' : 'd';
                });
                return;
            }
            var k = diffDays(iso, X);
            if (R.blocks && dow(iso) === 1) {
                owner.forEach(function (id, pos) {
                    if (id === null || CYCLE[(pos + k) % 5] !== 'P') return;
                    if (diffDays(iso, turnStart[id]) < 28) return;
                    var q = queue(iso, []); if (!q.length) return;
                    var inId = q[0];
                    lastTurn[id] = addDays(iso, -1); owner[pos] = inId; turnStart[inId] = iso;
                    swaps.push({ iso: iso, out: id, in: inId, pos: pos });
                });
            }
            ids.forEach(function (id) { role[iso][id] = owner.indexOf(id) >= 0 ? 't' : 'd'; });
            owner.forEach(function (id, pos) {
                if (id === null) return;
                var code = CYCLE[(pos + k) % 5];
                if (isAbs(iso, id)) {
                    if (code === 'M' || code === 'P' || code === 'N') covers.push({ iso: iso, shift: code, absent: id });
                    return;
                }
                if (!empty(iso, id)) return;
                // smonto di una notte non fatta (assente il giorno prima): giornata libera
                if (code === 'S' && isAbs(addDays(iso, -1), id)) { put(iso, id, 'R', { note: 'notte non fatta' }); return; }
                put(iso, id, code);
            });
        });
        days.forEach(function (iso) { ids.forEach(function (id) { if (role[iso][id] === 't') turnDays[id]++; else diurnoDays[id]++; }); });
        function coverName(iso, shift) { var c = covers.filter(function (x) { return x.iso === iso && x.shift === shift && !x.done; })[0]; if (c) { c.done = true; return nameOf[c.absent]; } return ''; }

        // ── 4. diurnisti, settimana per settimana ──
        var st = {};
        ids.forEach(function (id) { st[id] = { wkRest: 0, festWork: 0, m: 0, p: 0, extraN: 0, lastExtraN: '0000-01-01', debt: 0 }; });
        function countShift(iso, test) { var n = 0; ids.forEach(function (id) { if (!isAbs(iso, id) && test(vOf(iso, id))) n++; }); return n; }
        function credit(iso, id) {
            var c = cell(iso, id); if (!c) return 0;
            if (c.sub) return model.contractDow.indexOf(dow(iso)) >= 0 ? model.dayMin : 0;
            return codeMinutes(c.v, opts.model);
        }
        function mean(f) { var s = 0; ids.forEach(function (id) { s += f(id); }); return s / ids.length; }

        for (var ws = mondayOf(first); ws <= last; ws = addDays(ws, 7)) {
            var wk = []; for (var j = 0; j < 7; j++) wk.push(addDays(ws, j));
            // 4a. notti: la seconda notte (modello a 2) o la notte di un turnista assente
            wk.forEach(function (iso) {
                if (!G[iso]) return;
                var need = opts.nights - countShift(iso, isN), guard = 0;
                while (need > 0 && guard++ < 4) {
                    var next = addDays(iso, 1), after = addDays(iso, 2);
                    var cands = ids.filter(function (id) {
                        if (role[iso][id] !== 'd' || !empty(iso, id)) return false;
                        if (G[next] && !empty(next, id)) return false;
                        var pv = vOf(addDays(iso, -1), id); if (pv === 'N' || pv === 'S' || pv === 'M+N') return false;
                        return true;
                    }).sort(function (a, b) {
                        var ra = diffDays(iso, st[a].lastExtraN) < 5 ? 100 : 0, rb = diffDays(iso, st[b].lastExtraN) < 5 ? 100 : 0;
                        return (ra + st[a].extraN) - (rb + st[b].extraN) || ids.indexOf(a) - ids.indexOf(b);
                    });
                    if (!cands.length) break;
                    var who = cands[0], cn = coverName(iso, 'N');
                    put(iso, who, 'N', { cov: cn || (opts.nights > 1 ? '2ª notte' : '') });
                    if (G[next]) put(next, who, 'S');
                    if (G[after] && empty(after, who)) put(after, who, 'r', { note: 'riposo dopo la notte' });
                    st[who].extraN++; st[who].lastExtraN = iso; need--;
                }
            });

            // 4b. riposi: quanti giorni deve lavorare ognuno per arrivare a 36 h
            var people = [];
            ids.forEach(function (id) {
                var free = [], credits = 0, nd = 0;
                wk.forEach(function (iso, j) {
                    var r = G[iso] ? role[iso][id] : (role[first] && role[first][id]) || 'd';
                    if (r !== 'd') return;
                    nd++;
                    if (G[iso] && empty(iso, id)) free.push(j); else credits += credit(iso, id);
                });
                if (!free.length) return;
                var target = WEEK_MIN * nd / 7 + st[id].debt;
                var needWork = Math.max(0, Math.min(free.length, Math.round((target - credits) / model.dayMin)));
                // giorni prima della settimana lavorati di fila (per non superare 6)
                var streak = 0; for (var k = 1; k <= 7; k++) { var v = vOf(addDays(ws, -k), id); if (WORK[v] && !isAbs(addDays(ws, -k), id)) streak++; else break; }
                people.push({ id: id, free: free, restN: free.length - needWork, streak: streak, options: [], target: target, nd: nd });
            });
            var needDay = wk.map(function (iso) {
                if (!G[iso]) return { m: 0, p: 0 };
                return { m: Math.max(0, opts.covM - countShift(iso, isM)), p: Math.max(0, opts.covP - countShift(iso, isP)) };
            });
            var wkMean = mean(function (id) { return st[id].wkRest; }), festMean = mean(function (id) { return st[id].festWork; });
            people.forEach(function (pp) {
                // un riposo in più o in meno si può (le ore si recuperano la settimana dopo), ma costa
                [pp.restN, pp.restN + 1, pp.restN - 1, pp.restN + 2].forEach(function (k) {
                    if (k < 0 || k > pp.free.length) return;
                    combos(pp.free, k).forEach(function (set) { pp.options.push({ set: set, own: ownScore(pp, set) - 150 * Math.abs(k - pp.restN) }); });
                });
                if (!pp.options.length) pp.options.push({ set: [], own: 0 });
                pp.pick = pp.options.reduce(function (a, b) { return b.own > a.own ? b : a; });
            });
            function ownScore(pp, set) {
                var s = 0, id = pp.id;
                set.forEach(function (j) {
                    var iso = wk[j], g = dow(iso);
                    if (R.weekendRest && (g === 0 || g === 6)) s += 6 * (R.eqOp ? Math.max(0.2, 1 + 0.5 * (wkMean - st[id].wkRest)) : 1);
                    if (R.eqFest && fest(iso)) s += 3 * Math.max(0.2, 1 + 0.5 * (st[id].festWork - festMean));
                    var pv = vOf(addDays(iso, -1), id); if (pv === 'S') s += 10;
                });
                if (set.length >= 2) { for (var a = 1; a < set.length; a++) if (set[a] === set[a - 1] + 1) s += 4; }
                // massimo 6 giorni di lavoro di fila
                var run = pp.streak, worst = 0;
                for (var j = 0; j < 7; j++) {
                    var iso = wk[j], isRest = set.indexOf(j) >= 0 || (pp.free.indexOf(j) < 0 && (!WORK[vOf(iso, id)] || isAbs(iso, id)));
                    run = isRest ? 0 : run + 1; worst = Math.max(worst, run);
                }
                // e i giorni già scritti della settimana dopo (es. l'ingresso in turno: P › M › N › S)
                if (run > 0) for (var q = 7; q < 14; q++) { var fi = addDays(ws, q), fv = vOf(fi, id); if (WORK[fv] && !isAbs(fi, id)) { run++; worst = Math.max(worst, run); } else break; }
                if (worst > 6) s -= 300 * (worst - 6);
                return s;
            }
            function coverageScore() {
                var s = 0, cnt = [];
                for (var j = 0; j < 7; j++) {
                    var need = needDay[j].m + needDay[j].p, have = 0;
                    people.forEach(function (pp) { if (pp.free.indexOf(j) >= 0 && pp.pick.set.indexOf(j) < 0) have++; });
                    s -= 1000 * Math.max(0, need - have);
                    if (G[wk[j]]) cnt.push(have - need);
                }
                if (cnt.length) { var mu = cnt.reduce(function (a, b) { return a + b; }, 0) / cnt.length; cnt.forEach(function (c) { s -= 2 * (c - mu) * (c - mu); }); }
                return s;
            }
            for (var pass = 0; pass < 4; pass++) {
                people.forEach(function (pp) {
                    var best = pp.pick, bestS = -Infinity;
                    pp.options.forEach(function (o) { pp.pick = o; var sc = o.own + coverageScore(); if (sc > bestS + 1e-9) { bestS = sc; best = o; } });
                    pp.pick = best;
                });
            }
            people.forEach(function (pp) { pp.pick.set.forEach(function (j) { put(wk[j], pp.id, 'r'); }); });

            // 4c. mattina o pomeriggio per ogni giorno di lavoro
            wk.forEach(function (iso, j) {
                if (!G[iso]) return;
                var W = people.filter(function (pp) { return pp.free.indexOf(j) >= 0 && empty(iso, pp.id); }).map(function (pp) { return pp.id; });
                if (!W.length) return;
                var curM = countShift(iso, isM), curP = countShift(iso, isP);
                var needM = Math.max(0, opts.covM - curM), needP = Math.max(0, opts.covP - curP);
                var pref = {};
                W.forEach(function (id) {
                    var s = 0, nv = vOf(addDays(iso, 1), id), pv = vOf(addDays(iso, -1), id), pAbs = isAbs(addDays(iso, -1), id);
                    var nextRest = REST[nv] || (G[addDays(iso, 1)] && people.some(function (pp) { return pp.id === id && pp.pick.set.indexOf(j + 1) >= 0; }));
                    if (R.mBeforeRest && nextRest) s += 6;
                    if (R.mBeforeRest && (REST[pv] || pAbs)) s -= 6;
                    if (pv === 'p' || pv === 'P') s -= opts.model === '6h' ? 1 : 3;
                    if (nv === 'm' || nv === 'M') s += 2;
                    if (R.eqOp) s += 0.4 * (st[id].p - st[id].m);
                    pref[id] = s;
                });
                var sorted = W.slice().sort(function (a, b) { return pref[b] - pref[a]; }), best = 0, bestS = Infinity;
                for (var t = 0; t <= W.length; t++) {
                    var pen = 1000 * (Math.max(0, needM - t) + Math.max(0, needP - (W.length - t))) + 3 * Math.abs((curM + t) - (curP + W.length - t));
                    for (var q = 0; q < t; q++) pen -= pref[sorted[q]];
                    if (pen < bestS) { bestS = pen; best = t; }
                }
                sorted.forEach(function (id, q) {
                    var code = q < best ? 'm' : 'p'; put(iso, id, code); st[id][code]++;
                });
                ['M', 'P'].forEach(function (sh) {
                    var cn; while ((cn = coverName(iso, sh))) {
                        var who = sorted.filter(function (id) { return vOf(iso, id) === sh.toLowerCase() && !G[iso][id].cov; })[0];
                        if (!who) break; G[iso][who].cov = cn;
                    }
                });
            });
            // ore mancanti o in più: si recuperano la settimana dopo (al massimo un giorno)
            people.forEach(function (pp) {
                var done = 0;
                wk.forEach(function (iso) { var r = G[iso] ? role[iso][pp.id] : 'd'; if (r === 'd') done += credit(iso, pp.id); });
                st[pp.id].debt = Math.max(-model.dayMin, Math.min(model.dayMin, pp.target - done));
            });
            // statistiche per l'equità delle settimane dopo
            wk.forEach(function (iso) {
                if (!G[iso]) return;
                var g = dow(iso);
                ids.forEach(function (id) {
                    var v = vOf(iso, id), a = isAbs(iso, id);
                    if ((g === 0 || g === 6) && (REST[v] || a)) st[id].wkRest++;
                    if (fest(iso) && WORK[v] && !a) st[id].festWork++;
                });
            });
        }
        covers.forEach(function (c) { if (!c.done) issues.push({ kind: 'buco', iso: c.iso, text: 'Nessuno disponibile per coprire ' + shiftName(c.shift) + ' di ' + nameOf[c.absent] }); });

        // ── 5. reperibilità ──
        var rep = {}, repFixed = {}, repSt = {};
        ids.forEach(function (id) { repSt[id] = { n: 0, fest: 0, last: '0000-01-01' }; });
        Object.keys(input.histRep || {}).sort().forEach(function (iso) {
            var id = input.histRep[iso]; if (!repSt[id]) return;
            if (iso < first) { if (iso > repSt[id].last) repSt[id].last = iso; return; }
            if (iso > last) return;
            rep[iso] = id; repFixed[iso] = true;
        });
        days.forEach(function (iso) {
            if (rep[iso]) { var id0 = rep[iso]; repSt[id0].n++; if (fest(iso)) repSt[id0].fest++; repSt[id0].last = iso; return; }
            var pick = chooseRep(iso, []); if (!pick) { issues.push({ kind: 'rep', iso: iso, text: 'Nessun reperibile possibile' }); return; }
            rep[iso] = pick.id;
            if (!pick.gapOk) issues.push({ kind: 'rep', iso: iso, text: 'Reperibilità ravvicinata per ' + nameOf[pick.id] });
            repSt[pick.id].n++; if (fest(iso)) repSt[pick.id].fest++; repSt[pick.id].last = iso;
        });
        function chooseRep(iso, exclude) {
            var nx = addDays(iso, 1), gap = R.repGap ? opts.repGapDays : 1, f = fest(iso);
            function ok(id) { return exclude.indexOf(id) < 0 && !isAbs(iso, id) && !isAbs(nx, id); }
            var tiers = [function (v) { return isM(v); }, function (v) { return isP(v); }, function (v) { return !!v && v !== 'N' && v !== 'S'; }];
            for (var t = 0; t < tiers.length; t++) {
                var c = ids.filter(function (id) { return ok(id) && tiers[t](vOf(iso, id)); });
                if (!c.length) continue;
                c = c.map(function (id) { return { id: id, gapOk: diffDays(iso, repSt[id].last) >= gap, turn: role[iso] && role[iso][id] === 't' && vOf(iso, id) === 'M' }; });
                c.sort(function (a, b) {
                    if (a.gapOk !== b.gapOk) return a.gapOk ? -1 : 1;
                    if (!R.eqRep && a.turn !== b.turn) return a.turn ? -1 : 1;
                    if (R.eqRep) {
                        if (f && repSt[a.id].fest !== repSt[b.id].fest) return repSt[a.id].fest - repSt[b.id].fest;
                        if (repSt[a.id].n !== repSt[b.id].n) return repSt[a.id].n - repSt[b.id].n;
                    }
                    if (a.turn !== b.turn) return a.turn ? -1 : 1;
                    return diffDays(iso, repSt[b.id].last) - diffDays(iso, repSt[a.id].last);
                });
                return c[0];
            }
            return null;
        }

        var plan = {
            v: 1, year: Y, opts: opts, generatedAt: new Date().toISOString(), firstGenerated: X,
            ops: ops.map(function (o) { return { id: o.id, name: o.name }; }), holidays: hol,
            cells: G, role: role, rep: rep, repFixed: repFixed, swaps: swaps, issues: issues, requests: {}
        };
        return plan;
    }
    function mergeOpts(o) {
        o = o || {};
        var r = Object.assign({}, DEFAULT_OPTS, o);
        r.rules = Object.assign({}, DEFAULT_OPTS.rules, o.rules || {});
        if (!MODELS[r.model]) r.model = '7h12';
        r.nights = r.nights === 2 ? 2 : 1;
        return r;
    }
    function combos(arr, k) {
        var out = [];
        if (k <= 0) return [[]];
        if (k >= arr.length) return [arr.slice()];
        (function rec(start, acc) {
            if (acc.length === k) { out.push(acc.slice()); return; }
            for (var i = start; i < arr.length; i++) { acc.push(arr[i]); rec(i + 1, acc); acc.pop(); }
        })(0, []);
        return out;
    }
    function shiftName(s) { return { M: 'la mattina', P: 'il pomeriggio', N: 'la notte', m: 'la mattina', p: 'il pomeriggio' }[s] || s; }

    // ── controlli e statistiche su un piano ──
    function analyze(plan) {
        var opts = mergeOpts(plan.opts), ids = plan.ops.map(function (o) { return o.id; }), G = plan.cells, hol = plan.holidays || {};
        var days = Object.keys(G).sort(), nameOf = {}; plan.ops.forEach(function (o) { nameOf[o.id] = o.name; });
        var model = MODELS[opts.model];
        function fest(iso) { var dt = dateOf(iso); return dt.getDay() === 0 || !!hol[dt.getMonth() + '-' + dt.getDate()]; }
        function c(iso, id) { return (G[iso] && G[iso][id]) || null; }
        function v(iso, id) { var x = c(iso, id); return x && !x.sub ? x.v : ''; }
        var stats = {}, holes = [], warns = [];
        ids.forEach(function (id) { stats[id] = { min: 0, nights: 0, fest: 0, wkRest: 0, rep: 0, repFest: 0, turnDays: 0, dDays: 0, m: 0, p: 0, cov: 0, abs: 0, weeks: {} }; });
        days.forEach(function (iso, i) {
            var g = dow(iso), wkKey = mondayOf(iso);
            var cnt = { M: 0, P: 0, N: 0 };
            ids.forEach(function (id) {
                var x = c(iso, id), s = stats[id];
                if (!x) return;
                var min = 0;
                if (x.sub) { s.abs++; if (model.contractDow.indexOf(g) >= 0) min = model.dayMin; if ((g === 0 || g === 6)) s.wkRest++; }
                else {
                    min = codeMinutes(x.v, opts.model);
                    if (isM(x.v)) cnt.M++; if (isP(x.v)) cnt.P++; if (isN(x.v)) { cnt.N++; s.nights++; }
                    if (x.v === 'm') s.m++; if (x.v === 'p') s.p++;
                    if (WORK[x.v] && fest(iso)) s.fest++;
                    if (REST[x.v] && (g === 0 || g === 6)) s.wkRest++;
                    if (x.cov) s.cov++;
                }
                s.min += min; s.weeks[wkKey] = (s.weeks[wkKey] || 0) + min;
                if (plan.role[iso] && plan.role[iso][id] === 't') s.turnDays++; else s.dDays++;
                // regole sulla persona
                var nx = days[i + 1];
                if (nx && (x.v === 'N' || x.v === 'M+N') && !x.sub) { var y = c(nx, id); if (y && !y.sub && y.v !== 'S') warns.push({ iso: nx, id: id, text: nameOf[id] + ': dopo la notte manca lo smonto' }); }
                if (nx && x.v === 'S') { var z = c(nx, id); if (z && !z.sub && WORK[z.v] && z.v !== 'P' && z.v !== 'p') warns.push({ iso: nx, id: id, text: nameOf[id] + ': lavora di mattina il giorno dopo lo smonto' }); }
            });
            var pre = ids.every(function (id) { var x = c(iso, id); return x && x.fixed && !x.req && !x.manual; });
            if (cnt.M < opts.covM) holes.push({ iso: iso, shift: 'M', have: cnt.M, need: opts.covM, pre: pre });
            if (cnt.P < opts.covP) holes.push({ iso: iso, shift: 'P', have: cnt.P, need: opts.covP, pre: pre });
            if (cnt.N < opts.nights) holes.push({ iso: iso, shift: 'N', have: cnt.N, need: opts.nights, pre: pre });
        });
        // giorni di fila
        ids.forEach(function (id) {
            var run = 0;
            days.forEach(function (iso) { var x = c(iso, id); if (x && !x.sub && WORK[x.v]) { run++; if (run === 7) warns.push({ iso: iso, id: id, text: nameOf[id] + ': 7 giorni di lavoro di fila' }); } else run = 0; });
        });
        // reperibilità
        var lastRep = {};
        Object.keys(plan.rep || {}).sort().forEach(function (iso) {
            var id = plan.rep[iso]; if (!stats[id]) return;
            stats[id].rep++; if (fest(iso)) stats[id].repFest++;
            if (lastRep[id] && diffDays(iso, lastRep[id]) < (opts.rules.repGap ? opts.repGapDays : 1)) warns.push({ iso: iso, id: id, text: nameOf[id] + ': reperibilità ravvicinata (' + diffDays(iso, lastRep[id]) + ' giorni)' });
            lastRep[id] = iso;
            var x = c(iso, id); if (x && x.sub) warns.push({ iso: iso, id: id, text: nameOf[id] + ' è reperibile ma assente' });
        });
        ids.forEach(function (id) {
            var s = stats[id], wk = Object.keys(s.weeks).filter(function (k) { return k >= days[0] && addDays(k, 6) <= days[days.length - 1]; });
            var tot = wk.reduce(function (a, k) { return a + s.weeks[k]; }, 0);
            s.avgWeek = wk.length ? tot / wk.length : 0;
        });
        return { stats: stats, holes: holes, warns: warns, days: days };
    }

    // fabbisogno di ore a settimana con le regole scelte
    function needPerWeek(opts) {
        opts = mergeOpts(opts);
        var dayMin = opts.covM * 405 + opts.covP * 445 + opts.nights * (255 + 440);
        var min = dayMin * 7;
        return { minutes: min, people: min / WEEK_MIN };
    }

    // ═══ richieste: assenza in automatico o a mano ═══
    var REQ_SUB = {
        ferie: 'f', ferie_anno_prec: 'v', permesso: 'p', recupero_ore: 'r', permesso_matrimonio: 'a', permesso_studio: 'c',
        permesso_sportivo: 's', permesso_notte: 'pn', permesso_lutto: 'l', aspettativa: 'e', permesso_sindacale: 'ps', malattia: 'm'
    };
    function reqDates(r, plan) {
        var out = [], a = r.dateFrom, b = r.dateTo || r.dateFrom;
        if (!a) return out;
        if (b < a) b = a;
        for (var d = a; d <= b && out.length < 120; d = addDays(d, 1)) if (plan.cells[d]) out.push(d);
        return out;
    }
    // applica la richiesta al piano. mode 'auto' | 'manuale'. Ritorna { changes, holes, notes }
    function applyRequest(plan, req, mode) {
        var opts = mergeOpts(plan.opts), ids = plan.ops.map(function (o) { return o.id; }), G = plan.cells;
        var nameOf = {}; plan.ops.forEach(function (o) { nameOf[o.id] = o.name; });
        var who = matchOp(plan, req.name), other = req.swapWith ? matchOp(plan, req.swapWith) : null;
        var changes = [], holes = [], notes = [];
        function snap(iso, id) { return G[iso] && G[iso][id] ? JSON.parse(JSON.stringify(G[iso][id])) : null; }
        function set(iso, id, val, why) { if (!G[iso]) return; changes.push({ iso: iso, id: id, prev: snap(iso, id), why: why || '' }); if (val) G[iso][id] = val; else delete G[iso][id]; changes[changes.length - 1].next = val ? JSON.parse(JSON.stringify(val)) : null; }
        function setRep(iso, id, why) { changes.push({ iso: iso, rep: true, prev: plan.rep[iso] || null, next: id, why: why || '' }); plan.rep[iso] = id; }
        function v(iso, id) { var c = G[iso] && G[iso][id]; return c && !c.sub ? c.v : ''; }
        function abs(iso, id) { var c = G[iso] && G[iso][id]; return !!(c && c.sub); }
        function cnt(iso, test) { var n = 0; ids.forEach(function (id) { if (!abs(iso, id) && test(v(iso, id))) n++; }); return n; }
        if (!who) return { error: 'Operatore non trovato: ' + (req.name || '?') };

        if (req.type === 'cambio_turno') {
            if (!other) return { error: 'Collega del cambio non trovato' };
            var d0 = req.dateFrom; if (!G[d0]) return { error: 'Giorno fuori dall\u2019anno generato' };
            var a = snap(d0, who), b = snap(d0, other);
            set(d0, who, b ? Object.assign(b, { gen: true, cov: '', note: 'cambio con ' + nameOf[other] }) : null, 'cambio turno');
            set(d0, other, a ? Object.assign(a, { gen: true, cov: '', note: 'cambio con ' + nameOf[who] }) : null, 'cambio turno');
            notes.push('Scambiati i turni di ' + nameOf[who] + ' e ' + nameOf[other] + ' il ' + d0);
            return { changes: changes, holes: holes, notes: notes };
        }
        if (req.type === 'copertura_reperibilita') {
            if (!other) return { error: 'Collega che riceve la reperibilità non trovato' };
            var dr = req.repDate || req.dateFrom; if (!G[dr]) return { error: 'Giorno fuori dall\u2019anno generato' };
            setRep(dr, other, 'reperibilità ceduta da ' + nameOf[who]);
            notes.push('Reperibilità del ' + dr + ' passata da ' + nameOf[who] + ' a ' + nameOf[other]);
            return { changes: changes, holes: holes, notes: notes };
        }
        var sub = REQ_SUB[req.type];
        if (!sub) return { error: 'Questo tipo di richiesta (' + req.type + ') va inserito a mano' };
        var dates = reqDates(req, plan);
        if (!dates.length) return { error: 'Le date non sono nell\u2019anno generato (' + plan.year + ')' };
        dates.forEach(function (iso) {
            var prevV = v(iso, who);
            set(iso, who, { v: '', sub: sub, fixed: true, req: req.id || '' }, 'assenza');
            if (prevV === 'N' || prevV === 'M+N') {   // lo smonto del giorno dopo non c'è più
                var nx = addDays(iso, 1);
                if (G[nx] && v(nx, who) === 'S' && dates.indexOf(nx) < 0) set(nx, who, { v: plan.role[nx] && plan.role[nx][who] === 't' ? 'R' : 'r', sub: '', gen: true, note: 'notte non fatta' }, 'smonto tolto');
            }
            if (!WORK[prevV] || prevV === 'S') return;
            var shifts = prevV === 'M+N' ? ['M', 'N'] : [prevV.toUpperCase()];
            shifts.forEach(function (sh) {
                var test = sh === 'M' ? isM : sh === 'P' ? isP : isN, min = sh === 'M' ? opts.covM : sh === 'P' ? opts.covP : opts.nights;
                if (cnt(iso, test) >= min) { notes.push(iso + ': ' + shiftName(sh) + ' resta coperta (' + cnt(iso, test) + ' persone)'); return; }
                if (mode !== 'auto') { holes.push({ iso: iso, shift: sh, absent: who }); return; }
                var done = autoCover(iso, sh, who);
                if (!done) holes.push({ iso: iso, shift: sh, absent: who });
            });
        });
        // reperibilità di chi è assente (anche quella del giorno prima, che arriva alle 13 del giorno di assenza)
        var repDays = [addDays(dates[0], -1)].concat(dates);
        repDays.forEach(function (iso) {
            if (plan.rep[iso] !== who) return;
            if (iso === repDays[0] && plan.rep[iso] === who && dates.indexOf(addDays(iso, 1)) < 0) return;
            if (mode !== 'auto') { holes.push({ iso: iso, shift: 'REP', absent: who }); return; }
            var nr = pickRep(iso, [who]);
            if (nr) { setRep(iso, nr, 'reperibilità di ' + nameOf[who]); notes.push(iso + ': reperibilità a ' + nameOf[nr]); }
            else holes.push({ iso: iso, shift: 'REP', absent: who });
        });
        return { changes: changes, holes: holes, notes: notes };

        function autoCover(iso, sh, absent) {
            var cov = nameOf[absent], best = null;
            function consider(id, cost, apply) { if (!best || cost < best.cost) best = { id: id, cost: cost, apply: apply }; }
            var weekRests = function (id) { var m = mondayOf(iso), n = 0; for (var k = 0; k < 7; k++) { var x = G[addDays(m, k)] && G[addDays(m, k)][id]; if (x && !x.sub && REST[x.v]) n++; } return n; };
            var extra = function (id) { var m = mondayOf(iso), t = 0; for (var k = 0; k < 7; k++) { var dd = addDays(m, k), x = G[dd] && G[dd][id]; if (x) t += x.sub ? (MODELS[opts.model].contractDow.indexOf(dow(dd)) >= 0 ? MODELS[opts.model].dayMin : 0) : codeMinutes(x.v, opts.model); } return t - WEEK_MIN; };
            var pv = function (id) { return v(addDays(iso, -1), id); }, nv = function (id) { return v(addDays(iso, 1), id); };
            ids.forEach(function (id) {
                if (id === absent || abs(iso, id)) return;
                var cur = v(iso, id), isD = !plan.role[iso] || plan.role[iso][id] !== 't';
                if (sh === 'M' || sh === 'P') {
                    if (sh === 'M' && (pv(id) === 'N' || pv(id) === 'M+N')) return;
                    if (sh === 'P' && nv(id) === 'S') return;
                    // a) spostare un diurnista dall'altro turno, se lì sono in più del minimo
                    var other = sh === 'M' ? 'P' : 'M', otherTest = other === 'M' ? isM : isP, otherMin = other === 'M' ? opts.covM : opts.covP;
                    if (isD && (cur === other.toLowerCase()) && cnt(iso, otherTest) > otherMin) consider(id, 1, function () { set(iso, id, { v: sh.toLowerCase(), sub: '', gen: true, cov: cov }, 'spostato per coprire ' + cov); });
                    // b) richiamare un diurnista dal riposo (perde un riposo: ore in più)
                    if (isD && cur === 'r' && weekRests(id) >= 1 && pv(id) !== 'S') consider(id, 20 + Math.max(0, extra(id)) / 60 + (opts.rules.eqOp ? 0 : 0), function () { set(iso, id, { v: sh.toLowerCase(), sub: '', gen: true, cov: cov }, 'richiamato dal riposo'); });
                    // c) turnista nel giorno di riposo del ciclo (ultima scelta)
                    if (!isD && cur === 'R' && pv(id) !== 'S' && sh === 'P') consider(id, 60 + Math.max(0, extra(id)) / 60, function () { set(iso, id, { v: 'P', sub: '', gen: true, cov: cov }, 'richiamato dal riposo'); });
                } else {   // notte: serve anche lo smonto il giorno dopo
                    var nx = addDays(iso, 1), nxV = v(nx, id);
                    if (!isD || abs(nx, id)) return;
                    if (pv(id) === 'N' || pv(id) === 'S' || pv(id) === 'M+N') return;
                    var nxOk = !G[nx] || REST[nxV] || ((nxV === 'm' && cnt(nx, isM) > opts.covM) || (nxV === 'p' && cnt(nx, isP) > opts.covP));
                    if (!nxOk) return;
                    var base = cur === 'r' ? 20 : cur === 'm' ? 35 : -1; if (base < 0) return;
                    consider(id, base + Math.max(0, extra(id)) / 60, function () {
                        set(iso, id, { v: cur === 'm' ? 'M+N' : 'N', sub: '', gen: true, cov: cov }, 'notte di ' + cov);
                        if (G[nx]) set(nx, id, { v: 'S', sub: '', gen: true }, 'smonto');
                    });
                }
            });
            if (!best) return false;
            best.apply(); notes.push(iso + ': ' + shiftName(sh) + ' di ' + cov + ' coperta da ' + nameOf[best.id]);
            return true;
        }
        function pickRep(iso, exclude) {
            var gap = opts.rules.repGap ? opts.repGapDays : 1, near = {};
            // distanza dalla reperibilità più vicina della stessa persona, prima o dopo
            Object.keys(plan.rep).forEach(function (d) { if (d === iso) return; var id = plan.rep[d], k = Math.abs(diffDays(iso, d)); if (near[id] === undefined || k < near[id]) near[id] = k; });
            var count = {}; Object.keys(plan.rep).forEach(function (d) { count[plan.rep[d]] = (count[plan.rep[d]] || 0) + 1; });
            var c = ids.filter(function (id) { return exclude.indexOf(id) < 0 && !abs(iso, id) && !abs(addDays(iso, 1), id) && v(iso, id) && v(iso, id) !== 'N' && v(iso, id) !== 'S' && !REST[v(iso, id)]; });
            c.sort(function (a, b) {
                var ga = near[a] === undefined || near[a] >= gap, gb = near[b] === undefined || near[b] >= gap;
                if (ga !== gb) return ga ? -1 : 1;
                if (isM(v(iso, a)) !== isM(v(iso, b))) return isM(v(iso, a)) ? -1 : 1;
                return (count[a] || 0) - (count[b] || 0);
            });
            return c[0] || null;
        }
    }
    function revertChanges(plan, changes) {
        changes.slice().reverse().forEach(function (ch) {
            if (ch.rep) { if (ch.prev) plan.rep[ch.iso] = ch.prev; else delete plan.rep[ch.iso]; return; }
            if (!plan.cells[ch.iso]) return;
            if (ch.prev) plan.cells[ch.iso][ch.id] = ch.prev; else delete plan.cells[ch.iso][ch.id];
        });
    }
    function normName(n) { return String(n || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z]/g, ''); }
    function matchOp(plan, name) {
        var n = normName(name); if (!n) return null;
        var o = plan.ops.filter(function (x) { return normName(x.id) === n || normName(x.name) === n; })[0];
        return o ? o.id : null;
    }

    var GTEngine = { generate: generate, analyze: analyze, applyRequest: applyRequest, revertChanges: revertChanges, needPerWeek: needPerWeek, MODELS: MODELS, DEFAULT_OPTS: DEFAULT_OPTS, mergeOpts: mergeOpts, REQ_SUB: REQ_SUB, addDays: addDays, dow: dow };
    if (typeof window !== 'undefined') window.GTEngine = GTEngine;
    if (typeof module !== 'undefined' && module.exports) module.exports = GTEngine;
    if (typeof document === 'undefined') return;

    // ═══════════════════════ INTERFACCIA ═══════════════════════
    var GT = window.GT = {
        opts: null, plan: null, planYear: null, month: null, busy: false, reqs: [], reqUnsub: null, sel: null, filter: 'tutte'
    };
    var SUB_LABEL = { f: 'C.O.', v: 'FR', p: 'PERM', r: 'REC', a: 'MATR', c: 'STU', s: 'SPORT', pn: 'PN', l: 'LUTTO', e: 'ASP', ps: 'PS', m: 'MAL', nl: 'FNL', ng: 'FNG', z: 'COORD', k: 'DS', pl: 'PL', gr: 'GRAV', x: 'X' };
    var REQ_LABEL = {
        ferie: 'Congedo ordinario', ferie_anno_prec: 'Congedo anno precedente', permesso_ore: 'Permesso a ore', permesso: 'Permesso straordinario',
        recupero_ore: 'Recupero ore', permesso_matrimonio: 'Permesso matrimonio', permesso_studio: 'Permesso studio', permesso_sportivo: 'Permesso sportivo',
        permesso_notte: 'Permesso notte', permesso_lutto: 'Permesso lutto', aspettativa: 'Aspettativa', permesso_sindacale: 'Permesso sindacale',
        malattia: 'Malattia', copertura_reperibilita: 'Cessione reperibilità', cambio_turno: 'Cambio turno'
    };
    var MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
    var WD = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];

    function h(s) { return (s === undefined || s === null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function toast(msg, err) { if (typeof ccToast === 'function') ccToast(msg, err); }
    function fmtDay(iso) { var d = dateOf(iso); return WD[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3).toLowerCase(); }
    function hm(min) { var n = min < 0, m = Math.round(Math.abs(min)); return (n ? '−' : '') + Math.floor(m / 60) + 'h' + (m % 60 ? pad(m % 60) : ''); }
    function cap(s) { s = String(s || '').toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); }

    function loadOpts() {
        var o = null; try { o = JSON.parse(localStorage.getItem('gt_opts') || 'null'); } catch (e) {}
        GT.opts = mergeOpts(o || {});
        if (!GT.opts.year) GT.opts.year = (typeof SHIFT_YEAR !== 'undefined' ? SHIFT_YEAR : new Date().getFullYear()) + 1;
    }
    function saveOpts() { try { localStorage.setItem('gt_opts', JSON.stringify(GT.opts)); } catch (e) {} }
    function planDoc(year) { return db.collection('test_generatore').doc(String(year)); }
    function absDoc(year) { return db.collection('test_generatore').doc('assenze_' + year); }
    async function loadPlan(year) {
        if (GT.planYear === year && GT.plan) return GT.plan;
        GT.plan = null; GT.planYear = year;
        try { var s = await planDoc(year).get(); if (s.exists && s.data().json) GT.plan = JSON.parse(s.data().json); } catch (e) { console.error(e); }
        return GT.plan;
    }
    async function savePlan() {
        if (!GT.plan) return;
        await planDoc(GT.plan.year).set({ json: JSON.stringify(GT.plan), updatedAt: new Date().toISOString() });
    }
    async function loadExtraAbs(year) {
        try { var s = await absDoc(year).get(); return s.exists ? (s.data().list || []) : []; } catch (e) { return []; }
    }
    async function saveExtraAbs(year, list) { await absDoc(year).set({ list: list, updatedAt: new Date().toISOString() }); }

    // turni già scritti nell'app (calendario di prova) → ingresso del motore
    function appInput() {
        var ops = drivers.filter(function (d) { return !d.hidden; }).map(function (d) { return { id: d.originalName, name: d.name, idx: d.idx }; });
        var hist = {}, histRep = {};
        for (var r = 1; r < finalData.length; r++) {
            var iso = repRowDate(r); if (!iso) continue;
            hist[iso] = {};
            ops.forEach(function (o) {
                var code = draftCode(r, o.idx), cell = finalData[r][o.idx] || {};
                if (!code) return;
                if (code === 'ABS') { var sub = String(cell.subV || '').trim().toLowerCase() || 'x'; hist[iso][o.id] = { v: '', sub: sub }; return; }
                if (code === 'SM') code = 'S';
                hist[iso][o.id] = { v: code, sub: '' };
            });
        }
        try { var t = repData().tit; Object.keys(t).forEach(function (iso) { if (t[iso]) histRep[iso] = t[iso]; }); } catch (e) {}
        return { ops: ops.map(function (o) { return { id: o.id, name: o.name }; }), hist: hist, histRep: histRep };
    }
    function prefilledInfo(year, inp) {
        var n = 0, lastDay = null;
        Object.keys(inp.hist).forEach(function (iso) {
            if (iso.slice(0, 4) !== String(year)) return;
            var k = Object.keys(inp.hist[iso]).length; if (!k) return;
            n++; if (!lastDay || iso > lastDay) lastDay = iso;
        });
        return { days: n, last: lastDay };
    }

    async function gtGenerate() {
        if (GT.busy) return; GT.busy = true;
        try {
            var year = GT.opts.year, inp = appInput();
            if (GT.plan && GT.plan.year === year) {
                var ok = await ccConfirm('Rigenerare il ' + year + '?', 'Il piano generato e le modifiche fatte a mano nel piano vengono rifatti da capo. Restano i turni già compilati nel calendario e le assenze approvate dal portale.', 'Rigenera');
                if (!ok) return;
            }
            var extra = await loadExtraAbs(year);
            var t0 = performance.now();
            var plan = generate({ year: year, ops: inp.ops, hist: inp.hist, histRep: inp.histRep, holidays: holidaysFor(year), opts: GT.opts, extraAbs: extra });
            if (GT.plan && GT.plan.year === year) plan.requests = GT.plan.requests || {};
            Object.keys(plan.requests).forEach(function (k) { if (plan.requests[k].mode === 'auto') plan.requests[k].regenerated = true; });
            GT.plan = plan; GT.planYear = year;
            if (GT.month === null || GT.month === undefined) GT.month = Number(plan.firstGenerated.slice(5, 7)) - 1;
            await savePlan();
            toast('Turni del ' + year + ' generati in ' + Math.round(performance.now() - t0) + ' ms');
        } catch (e) { console.error(e); toast('Generazione non riuscita: ' + e.message, true); }
        finally { GT.busy = false; renderGen(); }
    }
    async function gtClear() {
        if (!GT.plan) return;
        var ok = await ccConfirm('Cancellare il piano del ' + GT.plan.year + '?', 'Si cancella solo il piano generato nell\u2019area test. Il calendario non cambia.', 'Cancella', 'solid-danger');
        if (!ok) return;
        await planDoc(GT.plan.year).delete(); GT.plan = null; renderGen();
    }

    // ── sezione Generazione turni ──
    var RULES = [
        { k: 'eqOp', n: 1, icon: 'balance', t: 'Equità fra tutti gli operatori', d: 'Stesse ore, notti, weekend liberi, festivi e turni di mattina e pomeriggio: chi ne ha avuti di meno passa avanti.' },
        { k: 'eqRep', n: 2, icon: 'phone_in_talk', t: 'Equità nelle reperibilità', d: 'La reperibilità va a chi ne ha fatte meno (i festivi si contano a parte), tra chi è di mattina quel giorno.' },
        { k: 'model', n: 3, icon: 'schedule', t: 'Modello orario dei diurnisti', d: '', model: true },
        { k: 'weekendRest', n: 4, icon: 'beach_access', t: 'Riposi dei diurnisti nel fine settimana', d: 'Quando la copertura lo permette i riposi cadono di sabato e domenica, a turno fra tutti.' },
        { k: 'mBeforeRest', n: 5, icon: 'wb_twilight', t: 'Mattina prima del riposo, pomeriggio dopo', d: 'Per i diurnisti: il giorno prima del riposo si lavora di mattina, il giorno dopo di pomeriggio.' },
        { k: 'blocks', n: 6, icon: 'repeat', t: 'Turno e diurno a rotazione: 5 settimane', d: 'Le posizioni da turnista sono sempre 5. Dopo 5 settimane il turnista lascia il posto al diurnista fuori turno da più tempo (il lunedì del pomeriggio).' },
        { k: 'repGap', n: 7, icon: 'event_busy', t: 'Reperibilità non ravvicinate', d: '', gap: true },
        { k: 'eqFest', n: 8, icon: 'calendar_month', t: 'Festivi distribuiti in modo equo', d: 'Domeniche e festivi: riposa prima chi ne ha lavorati di più.' }
    ];
    function ruleCard(r) {
        var o = GT.opts, on = !!o.rules[r.k], body = r.d;
        if (r.model) {
            body = '<div class="gt-seg">' + Object.keys(MODELS).map(function (k) {
                var m = MODELS[k];
                return '<button class="' + (o.model === k ? 'on' : '') + '" onclick="GT.setOpt(\'model\',\'' + k + '\')"><b>' + m.label + '</b><small>' + m.workDays + ' giorni · ' + m.rests + (m.rests > 1 ? ' riposi' : ' riposo') + ' a settimana</small><small>m ' + m.m + ' · p ' + m.p + '</small></button>';
            }).join('') + '</div>';
        }
        if (r.gap) body = 'Fra una reperibilità e la successiva della stessa persona almeno <input type="number" min="2" max="10" value="' + o.repGapDays + '" class="gt-num" onchange="GT.setOpt(\'repGapDays\',Math.max(2,Math.min(10,+this.value||4)))"> giorni.';
        return '<div class="gt-rule ' + (on || r.model ? 'on' : 'off') + (r.model ? ' wide' : '') + '">' +
            '<span class="gt-rule-n">' + r.n + '</span>' +
            '<span class="msym gt-rule-i">' + r.icon + '</span>' +
            '<div class="gt-rule-b"><b>' + r.t + '</b><div class="gt-rule-d">' + body + '</div></div>' +
            (r.model ? '<span class="gt-fixed">sempre</span>' : '<label class="cc-switch" title="Attiva o disattiva"><input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="GT.setRule(\'' + r.k + '\',this.checked)"><span></span></label>') +
            '</div>';
    }
    function fixedRules() {
        var o = GT.opts;
        return '<div class="gt-rule on"><span class="gt-rule-n">9</span><span class="msym gt-rule-i">nights_stay</span><div class="gt-rule-b"><b>Autisti in servizio</b><div class="gt-rule-d">Sempre <b>2 di mattina</b> e <b>2 di pomeriggio</b>. Di notte: ' +
            '<span class="gt-seg gt-seg-sm"><button class="' + (o.nights === 1 ? 'on' : '') + '" onclick="GT.setOpt(\'nights\',1)">1 autista</button><button class="' + (o.nights === 2 ? 'on' : '') + '" onclick="GT.setOpt(\'nights\',2)">2 autisti</button></span></div></div><span class="gt-fixed">sempre</span></div>' +
            '<div class="gt-rule on"><span class="gt-rule-n">10</span><span class="msym gt-rule-i">schedule</span><div class="gt-rule-b"><b>36 ore a settimana per tutti</b><div class="gt-rule-d">Turnisti: ciclo pomeriggio › mattina › notte › smonto › riposo (25 h 45 ogni 5 giorni = 36 h). Diurnisti: ' + MODELS[o.model].workDays + ' × ' + MODELS[o.model].label.replace(' al giorno', '') + ' = 36 h. Le assenze contano come giornata di contratto.</div></div><span class="gt-fixed">sempre</span></div>' +
            '<div class="gt-rule on"><span class="gt-rule-n">11</span><span class="msym gt-rule-i">fact_check</span><div class="gt-rule-b"><b>Turni già compilati e assenze restano come sono</b><div class="gt-rule-d">Il generatore parte da quello che c\u2019è già nel calendario (turni, ferie, reperibilità) e riempie solo le caselle vuote. Dopo una notte c\u2019è sempre lo smonto, mai 7 giorni di lavoro di fila.</div></div><span class="gt-fixed">sempre</span></div>';
    }
    function needHtml() {
        var o = GT.opts, n = needPerWeek(o), ops = drivers.filter(function (d) { return !d.hidden; }).length;
        var avail = ops * WEEK_MIN, ok = avail >= n.minutes;
        return '<div class="gt-need ' + (ok ? 'ok' : 'ko') + '"><span class="msym">' + (ok ? 'verified' : 'warning') + '</span><div><b>' +
            (ok ? 'Con ' + ops + ' operatori la copertura è possibile' : 'Con ' + ops + ' operatori non bastano le ore') + '</b><small>Servono ' + hm(n.minutes) + ' a settimana (' + o.covM + ' mattina, ' + o.covP + ' pomeriggio, ' + o.nights + ' notte con smonto); ' + ops + ' × 36 h = ' + hm(avail) + '. ' +
            (ok ? 'Le ore in più vanno a rinforzare mattine e pomeriggi in modo uniforme.' : 'Servirebbero almeno ' + Math.ceil(n.people) + ' operatori: il generatore copre tutto il possibile e segnala i buchi.') + '</small></div></div>';
    }
    function opsHtml() {
        var list = drivers.filter(function (d) { return !d.hidden; });
        var today = GT.plan ? (GT.plan.firstGenerated) : null;
        return '<div class="cc-panel"><div class="cc-panel-head"><h3>Operatori</h3><span class="gt-lock"><span class="material-icons-round">lock</span>Solo area test · bloccata per ora</span></div><div class="cc-panel-body">' +
            '<div class="gt-ops">' + list.map(function (d) {
                var r = GT.plan && today && GT.plan.role[today] ? GT.plan.role[today][d.originalName] : null;
                return '<span class="gt-op"><b>' + h(d.name) + '</b>' + (r ? '<small>' + (r === 't' ? 'turnista' : 'diurnista') + ' il ' + fmtDay(today) + '</small>' : '') + '<button class="gt-op-x" disabled title="Bloccato"><span class="material-icons-round">lock</span></button></span>';
            }).join('') + '</div>' +
            '<div class="gt-ops-actions"><button class="cc-btn" disabled><span class="msym">person_add</span>Aggiungi operatore</button><button class="cc-btn danger" disabled><span class="msym">person_remove</span>Rimuovi operatore</button></div>' +
            '<p class="cc-note">Aggiungere o togliere operatori dal generatore sarà possibile solo nell\u2019area test: per ora la funzione è bloccata. Il generatore usa gli operatori visibili nel calendario.</p></div></div>';
    }
    function kpi(icon, val, label, cls) { return '<div class="gt-kpi ' + (cls || '') + '"><span class="msym">' + icon + '</span><b>' + val + '</b><small>' + label + '</small></div>'; }
    function resultHtml() {
        var p = GT.plan; if (!p) return '';
        var A = analyze(p), ids = p.ops.map(function (o) { return o.id; });
        var genCells = 0; Object.keys(p.cells).forEach(function (iso) { ids.forEach(function (id) { var c = p.cells[iso][id]; if (c && c.gen) genCells++; }); });
        var avgW = ids.reduce(function (a, id) { return a + A.stats[id].avgWeek; }, 0) / ids.length;
        var cols = [
            { k: 'avgWeek', l: 'Ore / sett.', f: function (v) { return hm(v); } },
            { k: 'turnDays', l: 'Sett. in turno', f: function (v) { return (v / 7).toFixed(1); } },
            { k: 'dDays', l: 'Sett. diurno', f: function (v) { return (v / 7).toFixed(1); } },
            { k: 'nights', l: 'Notti' }, { k: 'fest', l: 'Festivi lavorati' }, { k: 'wkRest', l: 'Sab/dom liberi' },
            { k: 'rep', l: 'Reperibilità' }, { k: 'repFest', l: 'Rep. festive' }, { k: 'm', l: 'm' }, { k: 'p', l: 'p' }, { k: 'cov', l: 'Coperture' }, { k: 'abs', l: 'Assenze' }
        ];
        var avg = {}; cols.forEach(function (c) { avg[c.k] = ids.reduce(function (a, id) { return a + A.stats[id][c.k]; }, 0) / ids.length; });
        var rows = p.ops.map(function (o) {
            var s = A.stats[o.id];
            return '<tr><th>' + h(o.name) + '</th>' + cols.map(function (c) {
                var v = s[c.k], q = avg[c.k] ? v / avg[c.k] : 1, cls = c.k === 'abs' || c.k === 'cov' ? '' : (q >= 1.2 ? 'hi' : q <= 0.8 ? 'lo' : '');
                return '<td class="' + cls + '">' + (c.f ? c.f(v) : v) + '</td>';
            }).join('') + '</tr>';
        }).join('') + '<tr class="avg"><th>Media</th>' + cols.map(function (c) { return '<td>' + (c.f ? c.f(avg[c.k]) : avg[c.k].toFixed(1)) + '</td>'; }).join('') + '</tr>';
        var probs = A.holes.slice(0, 60).map(function (x) { return '<li><span class="msym" style="color:var(--cc-neg)">warning</span><span class="cc-grow">' + fmtDay(x.iso) + '<small>' + { M: 'mattina', P: 'pomeriggio', N: 'notte' }[x.shift] + ': ' + x.have + ' su ' + x.need + (x.pre ? ' · giorno già compilato nel calendario, il generatore non lo cambia' : '') + '</small></span><button class="cc-btn sm ghost" onclick="GT.goMonth(\'' + x.iso + '\')">Vedi</button></li>'; })
            .concat(A.warns.slice(0, 40).map(function (x) { return '<li><span class="msym" style="color:var(--cc-warn)">info</span><span class="cc-grow">' + fmtDay(x.iso) + '<small>' + h(x.text) + '</small></span><button class="cc-btn sm ghost" onclick="GT.goMonth(\'' + x.iso + '\')">Vedi</button></li>'; })).join('');
        var swaps = (p.swaps || []).filter(function (s) { return s.iso.slice(0, 4) === String(p.year); });
        return '<div class="cc-panel"><div class="cc-panel-head"><h3>Risultato ' + p.year + '</h3><span class="cc-hint">generato ' + new Date(p.generatedAt).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' · modello ' + MODELS[p.opts.model].label + ' · notte ' + p.opts.nights + '</span></div><div class="cc-panel-body">' +
            '<div class="gt-kpis">' + kpi('edit_calendar', genCells, 'caselle generate') + kpi('event_upcoming', fmtDay(p.firstGenerated), 'turnisti generati dal') + kpi('schedule', hm(avgW), 'ore medie a settimana', Math.abs(avgW - WEEK_MIN) <= 60 ? 'ok' : 'warn') +
            kpi(A.holes.length ? 'warning' : 'verified', A.holes.length, 'turni scoperti', A.holes.length ? 'ko' : 'ok') + kpi('info', A.warns.length, 'avvisi sulle regole', A.warns.length ? 'warn' : 'ok') + kpi('swap_horiz', swaps.length, 'cambi turno/diurno') + '</div>' +
            '<div class="gt-table-wrap"><table class="gt-eq"><thead><tr><th>Operatore</th>' + cols.map(function (c) { return '<th>' + c.l + '</th>'; }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
            '<p class="cc-note" style="margin-top:8px"><span class="gt-key hi"></span> oltre il 20% sopra la media · <span class="gt-key lo"></span> oltre il 20% sotto. Le settimane in turno e da diurno contano tutto l\u2019anno, anche i giorni già compilati.</p>' +
            (swaps.length ? '<details class="gt-det"><summary>Cambi turno ↔ diurno (' + swaps.length + ')</summary><p class="cc-note">' + swaps.map(function (s) { return fmtDay(s.iso) + ': esce ' + h(nameOf(s.out)) + ', entra ' + h(nameOf(s.in)); }).join(' · ') + '</p></details>' : '') +
            (probs ? '<details class="gt-det" ' + (A.holes.length ? 'open' : '') + '><summary>Da controllare (' + (A.holes.length + A.warns.length) + ')</summary><ul class="cc-list">' + probs + '</ul></details>' : '<div class="cc-empty"><span class="msym">verified</span>Tutto coperto, nessuna regola violata.</div>') +
            '</div></div>';
    }
    function nameOf(id) { var o = GT.plan && GT.plan.ops.filter(function (x) { return x.id === id; })[0]; return o ? o.name : id; }
    function cellHtml(iso, id) {
        var p = GT.plan, c = p.cells[iso][id], isRep = p.rep[iso] === id, sel = GT.sel && GT.sel.iso === iso && GT.sel.id === id;
        var cls = 'gt-c', inner = '', style = '';
        if (c) {
            if (c.sub) { cls += ' abs'; var col = (typeof SUB_CODE_COLORS !== 'undefined' && SUB_CODE_COLORS[c.sub]) || null; if (col) style = 'background:var(' + col.bg + ');color:var(' + col.fg + ')'; inner = '<b>' + h(SUB_LABEL[c.sub] || c.sub.toUpperCase()) + '</b>'; }
            else {
                var key = { M: 'M', P: 'P', N: 'N', S: 'SM', R: 'R', m: 'dM', p: 'dP', r: 'dR', 'M+N': 'N' }[c.v];
                if (key) style = 'background:var(--c-' + key + ');color:var(--t-' + key + ')';
                inner = '<b>' + h(c.v) + '</b>';
            }
            if (c.fixed && !c.req) cls += ' fixed';
            if (c.req) cls += ' req';
            if (c.cov) inner += '<span class="gt-cov">' + (c.cov === '2ª notte' ? '2ª notte' : 'copertura turno di ' + h(cap(c.cov))) + '</span>';
            else if (c.note) inner += '<span class="gt-cov soft">' + h(c.note) + '</span>';
        } else cls += ' empty';
        if (isRep) inner += '<span class="gt-rep' + (p.repFixed[iso] ? ' fixed' : '') + '">REP</span>';
        if (sel) cls += ' sel';
        return '<td class="' + cls + '" style="' + style + '" onclick="GT.pick(\'' + iso + '\',\'' + h(id).replace(/'/g, "\\'") + '\')">' + inner + '</td>';
    }
    function calendarHtml() {
        var p = GT.plan; if (!p) return '';
        var m = GT.month || 0, y = p.year, rows = '';
        var ids = p.ops.map(function (o) { return o.id; });
        Object.keys(p.cells).filter(function (iso) { return Number(iso.slice(5, 7)) - 1 === m; }).sort().forEach(function (iso) {
            var d = dateOf(iso), holName = p.holidays[d.getMonth() + '-' + d.getDate()], we = d.getDay() === 0 || d.getDay() === 6;
            var cnt = { M: 0, P: 0, N: 0 }; ids.forEach(function (id) { var c = p.cells[iso][id]; if (c && !c.sub) { if (isM(c.v)) cnt.M++; if (isP(c.v)) cnt.P++; if (isN(c.v)) cnt.N++; } });
            var o = p.opts, bad = function (k, need) { return cnt[k] < need ? ' ko' : ''; };
            rows += '<tr class="' + (we ? 'we' : '') + (holName ? ' hol' : '') + (iso < p.firstGenerated ? ' pre' : '') + '"><th class="gt-day"><b>' + d.getDate() + '</b> ' + WD[d.getDay()] + (holName ? '<small>' + h(holName) + '</small>' : '') + '</th>' +
                ids.map(function (id) { return cellHtml(iso, id); }).join('') +
                '<td class="gt-sum"><span class="' + bad('M', o.covM) + '">' + cnt.M + '</span><span class="' + bad('P', o.covP) + '">' + cnt.P + '</span><span class="' + bad('N', o.nights) + '">' + cnt.N + '</span></td></tr>';
        });
        return '<div class="cc-panel"><div class="cc-panel-head"><h3>Calendario generato</h3>' +
            '<div class="gt-month"><button class="cc-btn sm ghost" onclick="GT.nav(-1)" ' + (m <= 0 ? 'disabled' : '') + '><span class="msym">chevron_left</span></button><b>' + MONTHS[m] + ' ' + y + '</b><button class="cc-btn sm ghost" onclick="GT.nav(1)" ' + (m >= 11 ? 'disabled' : '') + '><span class="msym">chevron_right</span></button></div></div>' +
            '<div class="gt-legend"><span class="gt-c fixed sw"></span>già nel calendario <span class="gt-c sw"></span>generato <span class="gt-c req sw"></span>dal portale <span class="gt-rep">REP</span> reperibile <span class="gt-cov inl">copertura turno di …</span> chi copre un\u2019assenza · M P N: persone in servizio' + '</div>' +
            '<div class="gt-table-wrap gt-cal-wrap"><table class="gt-cal"><thead><tr><th class="gt-day">Giorno</th>' + p.ops.map(function (o) { return '<th>' + h(o.name) + '</th>'; }).join('') + '<th class="gt-sum"><span>M</span><span>P</span><span>N</span></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
            '<p class="cc-note" style="padding:10px 16px">Tocca una casella per cambiarla a mano.</p>' + editorHtml() + '</div>';
    }
    function editorHtml() {
        if (!GT.sel || !GT.plan || !GT.plan.cells[GT.sel.iso]) return '';
        var c = GT.plan.cells[GT.sel.iso][GT.sel.id] || {}, codes = ['M', 'P', 'N', 'S', 'R', 'm', 'p', 'r', 'M+N'], subs = ['f', 'v', 'p', 'r', 'm', 'c', 'l', 'pn', 'ps', 'e'];
        var others = GT.plan.ops.filter(function (o) { return o.id !== GT.sel.id; });
        return '<div class="gt-editor" id="gt-editor"><div class="gt-editor-h"><b>' + h(nameOf(GT.sel.id)) + ' · ' + fmtDay(GT.sel.iso) + '</b><button class="cc-icon-btn" onclick="GT.pick(null)"><span class="msym">close</span></button></div>' +
            '<div class="gt-editor-codes">' + codes.map(function (k) { return '<button class="' + (!c.sub && c.v === k ? 'on' : '') + '" onclick="GT.edit({v:\'' + k + '\'})">' + k + '</button>'; }).join('') + '<button onclick="GT.edit(null)" title="Svuota">—</button></div>' +
            '<div class="gt-editor-codes">' + subs.map(function (k) { return '<button class="abs ' + (c.sub === k ? 'on' : '') + '" onclick="GT.edit({sub:\'' + k + '\'})">' + (SUB_LABEL[k] || k) + '</button>'; }).join('') + '</div>' +
            '<label class="gt-editor-cov">Copertura turno di <select onchange="GT.editCov(this.value)"><option value="">nessuno</option>' + others.map(function (o) { return '<option value="' + h(o.name) + '" ' + (c.cov === o.name ? 'selected' : '') + '>' + h(o.name) + '</option>'; }).join('') + '</select></label>' +
            '<label class="gt-editor-cov"><input type="checkbox" ' + (GT.plan.rep[GT.sel.iso] === GT.sel.id ? 'checked' : '') + ' onchange="GT.editRep(this.checked)"> Reperibile in questo giorno</label></div>';
    }
    async function renderGen() {
        var main = document.getElementById('cc-main'); if (!main || ccSection !== 'generazione') return;
        if (!GT.opts) loadOpts();
        var o = GT.opts, inp = appInput();
        var years = [SHIFT_YEAR, SHIFT_YEAR + 1, SHIFT_YEAR + 2];
        if (years.indexOf(o.year) < 0) o.year = SHIFT_YEAR + 1;
        await loadPlan(o.year);
        var pre = prefilledInfo(o.year, inp);
        main.innerHTML = '<div class="gt">' +
            '<div class="cc-panel gt-hero"><div class="cc-panel-body">' +
            '<div class="gt-hero-row"><div><div class="gt-eyebrow">Area test · scollegata da Firebase</div><h3 class="gt-h">Genera i turni di un anno intero</h3>' +
            '<p class="cc-note">Scegli l\u2019anno, controlla le regole qui sotto e premi Genera. Il risultato resta nell\u2019area test: il calendario dell\u2019app non viene toccato.</p></div>' +
            '<div class="gt-year">' + years.map(function (y) { return '<button class="' + (o.year === y ? 'on' : '') + '" onclick="GT.setYear(' + y + ')">' + y + '</button>'; }).join('') + '</div></div>' +
            '<div class="gt-pre"><span class="msym">' + (pre.days ? 'event_upcoming' : 'info') + '</span><span>' + (pre.days ? 'Nel calendario il ' + o.year + ' ha già <b>' + pre.days + ' giorni compilati</b> (fino al ' + fmtDay(pre.last) + '): il generatore parte da lì e li lascia com\u2019erano.' : 'Nel calendario il ' + o.year + ' è vuoto: il generatore parte dagli ultimi turni dell\u2019anno prima, se ci sono.') + '</span></div>' +
            '<div class="gt-actions"><button class="cc-btn primary" onclick="GT.generate()" ' + (GT.busy ? 'disabled' : '') + '><span class="msym">edit_calendar</span>' + (GT.plan ? 'Rigenera il ' : 'Genera il ') + o.year + '</button>' +
            (GT.plan ? '<button class="cc-btn" onclick="GT.goCalendar()"><span class="msym">calendar_month</span>Vai al calendario generato</button><button class="cc-btn danger" onclick="GT.clear()"><span class="msym">delete</span>Cancella piano</button>' : '') +
            '<button class="cc-btn ghost" onclick="ccGo(\'richiestetest\')"><span class="msym">inventory_2</span>Richieste dal portale</button></div>' +
            '</div></div>' +
            '<div class="cc-panel"><div class="cc-panel-head"><h3>Regole del generatore</h3><span class="cc-hint">valgono per ogni generazione · si attivano e disattivano qui</span></div><div class="gt-rules">' +
            RULES.map(ruleCard).join('') + fixedRules() + '</div>' + needHtml() + '</div>' +
            resultHtml() + '<div id="gt-cal-anchor"></div>' + calendarHtml() + opsHtml() + '</div>';
    }

    // ── sezione Richieste dal portale ──
    function reqStatus(r) {
        var g = r.gestione || '';
        if (g === 'automatica') return '<span class="cc-tag accent">gestita in automatico</span>';
        if (g === 'manuale') return '<span class="cc-tag warn">da inserire a mano</span>';
        if (g === 'rifiutata') return '<span class="cc-tag danger">rifiutata</span>';
        return '<span class="cc-tag">da gestire</span>';
    }
    function reqPeriod(r) {
        if (r.type === 'copertura_reperibilita') return 'reperibilità del ' + fmtDay(r.repDate || r.dateFrom) + (r.swapWith ? ' a ' + r.swapWith : '');
        if (r.type === 'cambio_turno') return fmtDay(r.dateFrom) + ' con ' + (r.swapWith || '?');
        if (!r.dateFrom) return '';
        return (r.dateTo && r.dateTo !== r.dateFrom) ? 'dal ' + fmtDay(r.dateFrom) + ' al ' + fmtDay(r.dateTo) : fmtDay(r.dateFrom);
    }
    function listenReqs() {
        if (GT.reqUnsub || typeof db === 'undefined' || !db) return;
        try {
            GT.reqUnsub = db.collection('richieste_turni').onSnapshot(function (snap) {
                GT.reqs = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }).filter(function (r) { return r.test; })
                    .sort(function (a, b) { return String(b.timestamp || '').localeCompare(String(a.timestamp || '')); });
                var n = GT.reqs.filter(function (r) { return !r.gestione && !r.obscured; }).length;
                var el = document.getElementById('cc-count-gtreq'); if (el) el.textContent = n ? n : '';
                if (typeof ccSection !== 'undefined' && ccSection === 'richiestetest') renderReqs();
            }, function (e) { console.error(e); });
        } catch (e) { console.error(e); }
    }
    function renderReqs() {
        var main = document.getElementById('cc-main'); if (!main || ccSection !== 'richiestetest') return;
        listenReqs();
        var f = GT.filter, list = GT.reqs.filter(function (r) { return f === 'tutte' || (f === 'da' ? !r.gestione : !!r.gestione); });
        var portal = 'portale-richieste.html';
        main.innerHTML = '<div class="gt">' +
            '<div class="cc-panel gt-hero"><div class="cc-panel-body"><div class="gt-hero-row"><div><div class="gt-eyebrow">Area test · portale finto</div><h3 class="gt-h">Richieste dei dipendenti</h3>' +
            '<p class="cc-note">Le richieste mandate dal portale di prova arrivano qui. Tocca <b>Gestisci</b> e scegli: in automatico il generatore trova chi copre l\u2019assenza e nel calendario generato compare «copertura turno di …»; a mano l\u2019assenza viene segnata e i turni scoperti restano da sistemare.</p></div>' +
            '<a class="cc-btn primary" href="' + portal + '" target="_blank" rel="noopener"><span class="msym">open_in_new</span>Apri il portale richieste</a></div></div></div>' +
            '<div class="cc-panel"><div class="cc-panel-head"><h3>Richieste</h3><div class="gt-seg gt-seg-sm">' + [['tutte', 'Tutte'], ['da', 'Da gestire'], ['gestite', 'Gestite']].map(function (x) { return '<button class="' + (f === x[0] ? 'on' : '') + '" onclick="GT.setFilter(\'' + x[0] + '\')">' + x[1] + '</button>'; }).join('') + '</div></div>' +
            (list.length ? '<ul class="cc-list gt-reqs">' + list.map(function (r) {
                var res = GT.plan && GT.plan.requests && GT.plan.requests[r.id];
                return '<li><span class="msym">' + (r.type === 'cambio_turno' ? 'swap_horiz' : r.type === 'copertura_reperibilita' ? 'phone_in_talk' : 'beach_access') + '</span><span class="cc-grow"><b>' + h(r.name) + '</b> · ' + h(REQ_LABEL[r.type] || r.type) +
                    '<small>' + h(reqPeriod(r)) + (r.note ? ' · «' + h(r.note) + '»' : '') + '</small>' +
                    (res && res.notes && res.notes.length ? '<small class="gt-res">' + res.notes.slice(0, 8).map(function (t) { return h(String(t).replace(/(\d{4}-\d{2}-\d{2})/g, function (m) { return fmtDay(m); })); }).join('<br>') + (res.holes && res.holes.length ? '<br><b style="color:var(--cc-neg)">Scoperti: ' + res.holes.map(function (x) { return fmtDay(x.iso) + ' ' + ({ M: 'mattina', P: 'pomeriggio', N: 'notte', REP: 'reperibilità' }[x.shift]); }).join(', ') + '</b>' : '') + '</small>' : '') +
                    '</span>' + reqStatus(r) +
                    (r.gestione ? (r.gestione !== 'rifiutata' && res ? '<button class="cc-btn sm" onclick="GT.reqView(\'' + r.id + '\')">Vedi</button>' : '') + '<button class="cc-btn sm ghost" onclick="GT.reqUndo(\'' + r.id + '\')" title="Torna da gestire"><span class="msym">undo</span></button>' : '<button class="cc-btn sm primary" onclick="GT.reqHandle(\'' + r.id + '\')">Gestisci</button>') + '</li>';
            }).join('') + '</ul>' : '<div class="cc-empty"><span class="msym">inventory_2</span>Nessuna richiesta. Aprila dal portale di prova: arriva qui subito.</div>') +
            '</div></div>';
    }
    async function reqHandle(id) {
        var r = GT.reqs.filter(function (x) { return x.id === id; })[0]; if (!r) return;
        var year = Number(String(r.repDate || r.dateFrom || '').slice(0, 4)) || GT.opts.year;
        var choice = await ccDialog('Richiesta di ' + r.name, (REQ_LABEL[r.type] || r.type) + ' · ' + reqPeriod(r) + '. Come vuoi inserirla?', [
            { label: 'Annulla', kind: 'ghost', value: null }, { label: 'Rifiuta', kind: 'danger', value: 'rifiutata' },
            { label: 'Inserisci manualmente', kind: '', value: 'manuale' }, { label: 'In automatico', kind: 'primary', value: 'automatica' }
        ]);
        if (!choice) return;
        if (choice !== 'rifiutata') {
            GT.opts.year = year; saveOpts();
            await loadPlan(year);
            if (!GT.plan) { toast('Prima genera i turni del ' + year + ' (Generazione turni).', true); return; }
            if (!GTEngine.REQ_SUB[r.type] && r.type !== 'cambio_turno' && r.type !== 'copertura_reperibilita' && choice === 'automatica') { toast('Questa richiesta (' + (REQ_LABEL[r.type] || r.type) + ') va inserita a mano.', true); return; }
            var res = applyRequest(GT.plan, r, choice === 'automatica' ? 'auto' : 'manuale');
            if (res.error) { toast(res.error, true); return; }
            GT.plan.requests[r.id] = { mode: choice === 'automatica' ? 'auto' : 'manuale', at: new Date().toISOString(), changes: res.changes, holes: res.holes, notes: res.notes };
            await savePlan();
            // le assenze approvate restano anche se il piano si rigenera
            var sub = GTEngine.REQ_SUB[r.type];
            if (sub) { var ex = await loadExtraAbs(year); ex = ex.filter(function (a) { return a.reqId !== r.id; }); res.changes.forEach(function (c) { if (!c.rep && c.why === 'assenza') ex.push({ id: c.id, iso: c.iso, sub: sub, reqId: r.id }); }); await saveExtraAbs(year, ex); }
            if (res.changes.length) GT.month = Number(res.changes[0].iso.slice(5, 7)) - 1;
        }
        await db.collection('richieste_turni').doc(r.id).update({ gestione: choice, gestitaIl: new Date().toISOString(), stato: choice === 'rifiutata' ? 'rifiutata' : 'approvata' });
        toast(choice === 'automatica' ? 'Richiesta inserita: coperture aggiornate nel calendario generato.' : choice === 'manuale' ? 'Assenza segnata: sistema a mano i turni scoperti.' : 'Richiesta rifiutata.');
        renderReqs();
    }
    async function reqUndo(id) {
        var r = GT.reqs.filter(function (x) { return x.id === id; })[0]; if (!r) return;
        var ok = await ccConfirm('Rimettere la richiesta da gestire?', 'Le modifiche fatte al calendario generato per questa richiesta vengono annullate.', 'Rimetti da gestire');
        if (!ok) return;
        var year = Number(String(r.repDate || r.dateFrom || '').slice(0, 4)) || GT.opts.year;
        await loadPlan(year);
        if (GT.plan && GT.plan.requests && GT.plan.requests[id]) {
            var q = GT.plan.requests[id];
            if (!q.regenerated) revertChanges(GT.plan, q.changes || []);
            delete GT.plan.requests[id]; await savePlan();
            if (q.regenerated) toast('Il piano è stato rigenerato dopo: rigeneralo per togliere del tutto l\u2019assenza.');
        }
        var ex = await loadExtraAbs(year); await saveExtraAbs(year, ex.filter(function (a) { return a.reqId !== id; }));
        await db.collection('richieste_turni').doc(id).update({ gestione: '', stato: 'in attesa' });
        renderReqs();
    }
    function reqView(id) {
        var r = GT.reqs.filter(function (x) { return x.id === id; })[0];
        var d = r && (r.repDate || r.dateFrom); if (d) { GT.opts.year = Number(d.slice(0, 4)); GT.month = Number(d.slice(5, 7)) - 1; saveOpts(); }
        ccGo('generazione'); setTimeout(GT.goCalendar, 80);
    }

    // ── azioni ──
    GT.generate = gtGenerate;
    GT.clear = gtClear;
    GT.setYear = function (y) { GT.opts.year = y; GT.month = null; GT.sel = null; saveOpts(); renderGen(); };
    GT.setRule = function (k, v) { GT.opts.rules[k] = !!v; saveOpts(); renderGen(); };
    GT.setOpt = function (k, v) { GT.opts[k] = v; saveOpts(); renderGen(); };
    GT.nav = function (d) { GT.month = Math.max(0, Math.min(11, (GT.month || 0) + d)); GT.sel = null; renderGen().then(GT.goCalendar); };
    GT.goMonth = function (iso) { GT.month = Number(iso.slice(5, 7)) - 1; renderGen().then(GT.goCalendar); };
    GT.goCalendar = function () { var a = document.getElementById('gt-cal-anchor'); if (a) a.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    GT.pick = function (iso, id) { GT.sel = iso ? { iso: iso, id: id } : null; var y = document.getElementById('cc-main').scrollTop; renderGen().then(function () { document.getElementById('cc-main').scrollTop = y; }); };
    GT.edit = async function (val) {
        var s = GT.sel; if (!s || !GT.plan) return;
        var cur = GT.plan.cells[s.iso][s.id];
        if (!val) delete GT.plan.cells[s.iso][s.id];
        else GT.plan.cells[s.iso][s.id] = val.sub ? { v: '', sub: val.sub, fixed: true, manual: true } : { v: val.v, sub: '', gen: true, manual: true, cov: cur && !cur.sub ? cur.cov || '' : '' };
        await savePlan(); GT.pick(s.iso, s.id);
    };
    GT.editCov = async function (name) { var s = GT.sel; if (!s) return; var c = GT.plan.cells[s.iso][s.id]; if (!c) return; c.cov = name; await savePlan(); GT.pick(s.iso, s.id); };
    GT.editRep = async function (on) { var s = GT.sel; if (!s) return; if (on) GT.plan.rep[s.iso] = s.id; else if (GT.plan.rep[s.iso] === s.id) delete GT.plan.rep[s.iso]; await savePlan(); GT.pick(s.iso, s.id); };
    GT.setFilter = function (f) { GT.filter = f; renderReqs(); };
    GT.reqHandle = reqHandle; GT.reqUndo = reqUndo; GT.reqView = reqView;

    // ── aggancio alla console ──
    window.GT_RENDER = { generazione: function () { renderGen(); }, richiestetest: function () { renderReqs(); } };
    if (typeof CC_SECTIONS !== 'undefined') {
        CC_SECTIONS.generazione = { title: 'Generazione turni', sub: 'Crea i turni di un anno intero seguendo regole fisse, partendo da quelli già compilati. Solo area test.' };
        CC_SECTIONS.richiestetest = { title: 'Richieste dal portale', sub: 'Ferie, permessi e cambi mandati dal portale di prova: gestiscili a mano o in automatico.' };
    }
    loadOpts();
    function startListen() { if (typeof fbReady !== 'undefined' && fbReady && typeof db !== 'undefined' && db) listenReqs(); else setTimeout(startListen, 1500); }
    startListen();

    // ── stile ──
    var css = [
        '.gt{max-width:1180px}',
        '.gt-hero .cc-panel-body{background:linear-gradient(135deg,var(--cc-accent-soft),transparent 70%)}',
        '.gt-hero-row{display:flex;gap:18px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}',
        '.gt-eyebrow{font:600 11px/1 var(--cc-font);letter-spacing:.12em;text-transform:uppercase;color:#e10600;margin-bottom:6px}',
        '.gt-h{margin:0 0 4px;font-size:19px;font-weight:600;color:var(--cc-text)}',
        '.gt-year,.gt-seg{display:inline-flex;border:1px solid var(--cc-line);border-radius:6px;overflow:hidden;background:var(--cc-surface)}',
        '.gt-year button,.gt-seg button{border:0;background:transparent;padding:9px 16px;font:600 14px var(--cc-font);color:var(--cc-muted);cursor:pointer;border-right:1px solid var(--cc-line-2);text-align:left}',
        '.gt-year button:last-child,.gt-seg button:last-child{border-right:0}',
        '.gt-year button.on,.gt-seg button.on{background:var(--cc-accent);color:#fff}',
        '.gt-seg button b{display:block;font-size:13.5px}.gt-seg button small{display:block;font-weight:400;font-size:11.5px;opacity:.85}',
        '.gt-seg-sm button{padding:5px 11px;font-size:12.5px}',
        '.gt-pre{display:flex;gap:10px;align-items:flex-start;margin:14px 0 0;padding:10px 12px;border-radius:6px;background:var(--cc-surface);border:1px solid var(--cc-line-2);font-size:13px}',
        '.gt-pre .msym{color:var(--cc-accent)}',
        '.gt-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}',
        '.gt-rules{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:10px;padding:14px}',
        '.gt-rule{display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--cc-line);border-radius:8px;background:var(--cc-surface);position:relative}',
        '.gt-rule.off{opacity:.55;background:var(--cc-surface-2)}',
        '.gt-rule-n{flex:0 0 24px;height:24px;border-radius:50%;background:var(--cc-ink);color:#fff;font:700 12px/24px var(--cc-font);text-align:center}',
        '.gt-rule.on .gt-rule-n{background:var(--cc-accent)}',
        '.gt-rule-i{color:var(--cc-accent);margin-top:2px}',
        '.gt-rule-b{flex:1;min-width:0}.gt-rule-b>b{display:block;font-size:13.5px;font-weight:600;margin-bottom:3px}',
        '.gt-rule-d{font-size:12.5px;color:var(--cc-muted)}.gt-rule-d .gt-seg{margin-top:6px}',
        '.gt-fixed{font:600 10.5px/1 var(--cc-font);text-transform:uppercase;letter-spacing:.06em;color:var(--cc-muted);border:1px solid var(--cc-line);border-radius:3px;padding:3px 5px}',
        '.gt-num{width:48px;height:26px;border:1px solid var(--cc-line);border-radius:4px;padding:0 4px;text-align:center;background:var(--cc-surface);color:var(--cc-text)}',
        '.gt-need{display:flex;gap:10px;margin:0 14px 14px;padding:10px 12px;border-radius:6px;font-size:13px}',
        '.gt-need small{display:block;color:var(--cc-muted);margin-top:2px}',
        '.gt-need.ok{background:var(--cc-pos-soft)}.gt-need.ok .msym{color:var(--cc-pos)}',
        '.gt-need.ko{background:var(--cc-warn-soft)}.gt-need.ko .msym{color:var(--cc-warn)}',
        '.gt-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:14px}',
        '.gt-kpi{border:1px solid var(--cc-line-2);border-radius:6px;padding:10px 12px;display:grid;grid-template-columns:auto 1fr;column-gap:8px;align-items:center}',
        '.gt-kpi .msym{grid-row:span 2;color:var(--cc-muted)}.gt-kpi b{font-size:16px;white-space:nowrap}.gt-kpi small{color:var(--cc-muted);font-size:11.5px}',
        '.gt-kpi.ok .msym{color:var(--cc-pos)}.gt-kpi.ko .msym,.gt-kpi.ko b{color:var(--cc-neg)}.gt-kpi.warn .msym{color:var(--cc-warn)}',
        '.gt-table-wrap{overflow:auto;max-width:100%}',
        /* le regole del calendario dell'app (tbody td, thead th) non valgono qui */
        '.gt table thead th{position:static;top:auto;min-width:0;height:auto;backdrop-filter:none;text-transform:none;letter-spacing:0;overflow:visible;background:var(--cc-surface);border-bottom:1px solid var(--cc-line)}',
        '.gt table thead th::before{display:none}',
        '.gt table tbody td{height:auto;border-right:0;border-bottom:1px solid var(--cc-line-2);transition:none;padding:6px 8px}',
        '.gt-rule.wide{grid-column:span 2}@media (max-width:760px){.gt-rule.wide{grid-column:auto}}',
        '.gt-rule .gt-seg{display:flex;flex-wrap:wrap}.gt-rule .gt-seg button{flex:1;min-width:120px}',
        '.gt-eq{border-collapse:collapse;width:100%;font-size:12.5px}',
        '.gt-eq th,.gt-eq td{padding:6px 8px;border-bottom:1px solid var(--cc-line-2);text-align:right;white-space:nowrap}',
        '.gt-eq th:first-child{text-align:left}.gt-eq thead th{font-weight:600;color:var(--cc-muted);font-size:11.5px}',
        '.gt-eq td.hi{background:var(--cc-warn-soft);color:var(--cc-warn);font-weight:600}.gt-eq td.lo{background:var(--cc-accent-soft);color:var(--cc-accent);font-weight:600}',
        '.gt-eq tr.avg td,.gt-eq tr.avg th{font-weight:600;border-top:2px solid var(--cc-line)}',
        '.gt-key{display:inline-block;width:10px;height:10px;border-radius:2px;vertical-align:middle}.gt-key.hi{background:var(--cc-warn-soft);border:1px solid var(--cc-warn)}.gt-key.lo{background:var(--cc-accent-soft);border:1px solid var(--cc-accent)}',
        '.gt-det{margin-top:12px}.gt-det summary{cursor:pointer;font-weight:600;font-size:13px;padding:6px 0}',
        '.gt-month{display:flex;align-items:center;gap:6px}.gt-month b{min-width:130px;text-align:center}',
        '.gt-legend{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;padding:10px 16px;font-size:12px;color:var(--cc-muted);border-bottom:1px solid var(--cc-line-2)}',
        '.gt-legend .sw{display:inline-block;width:16px;height:14px;border-radius:3px;vertical-align:middle;margin-right:4px;background:var(--cc-surface-2);border:1px solid var(--cc-line)}',
        '.gt-cal-wrap{max-height:70vh}',
        '.gt-cal{border-collapse:separate;border-spacing:2px;font-size:12px;min-width:100%}',
        '.gt .gt-cal thead th{position:sticky;top:0;z-index:2;background:var(--cc-surface);font-weight:600;font-size:11.5px;padding:6px 4px;color:var(--cc-muted)}',
        '.gt .gt-cal th.gt-day{position:sticky;left:0;z-index:1;background:var(--cc-surface);text-align:left;white-space:nowrap;padding:3px 8px;font-weight:400;color:var(--cc-muted);min-width:78px}',
        '.gt .gt-cal thead th.gt-day{z-index:3;top:0}',
        '.gt-cal th.gt-day b{color:var(--cc-text);font-size:13px}.gt-cal th.gt-day small{display:block;font-size:10px;color:#e10600;font-weight:600}',
        '.gt-cal tr.we th.gt-day,.gt-cal tr.hol th.gt-day{background:var(--cc-surface-2)}.gt-cal tr.hol th.gt-day b{color:#e10600}',
        '.gt .gt-cal tbody td.gt-c{min-width:74px;height:40px;border:0;text-align:center;vertical-align:middle;border-radius:4px;background:var(--cc-surface-2);cursor:pointer;position:relative;padding:2px 3px;line-height:1.1}',
        '.gt-c b{font:700 14px/1 var(--cc-font-c)}',
        '.gt-c.fixed{box-shadow:inset 0 0 0 2px rgba(0,0,0,.18)}.gt-c.fixed::after{content:"";position:absolute;top:3px;left:3px;width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.85);box-shadow:0 0 0 1px rgba(0,0,0,.3)}',
        '.gt-c.req{box-shadow:inset 0 0 0 2px #e10600}',
        '.gt .gt-cal tbody td.gt-c.empty{background:transparent;border:1px dashed var(--cc-line)}',
        '.gt .gt-cal tbody td.gt-sum{border:0;padding:0 4px}',
        '.gt-c.sel{outline:3px solid var(--cc-accent);outline-offset:1px}',
        '.gt-cov{display:block;font:600 9.5px/1.1 var(--cc-font);margin-top:2px;padding:1px 3px;border-radius:3px;background:#fff7d6;color:#7a4b00;white-space:normal}',
        '.gt-cov.soft{background:rgba(255,255,255,.75);color:#334155;font-weight:500}.gt-cov.inl{display:inline-block}',
        '.gt-rep{position:absolute;top:2px;right:2px;font:800 8.5px/1 var(--cc-font);background:#fde047;color:#422006;border-radius:3px;padding:2px 3px}',
        '.gt-legend .gt-rep{position:static}',
        '.gt-rep.fixed{background:#fef9c3}',
        '.gt-sum{white-space:nowrap;font:600 11px var(--cc-font-c);color:var(--cc-muted);padding:0 4px}.gt-sum span{display:inline-block;width:14px;text-align:center}.gt-sum span.ko{color:#fff;background:var(--cc-neg);border-radius:3px}',
        '.gt-editor{position:sticky;bottom:0;margin:0 12px 12px;padding:12px;border:1px solid var(--cc-accent);border-radius:8px;background:var(--cc-surface);box-shadow:0 8px 24px rgba(0,0,0,.18)}',
        '.gt-editor-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}',
        '.gt-editor-codes{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px}',
        '.gt-editor-codes button{min-width:40px;height:32px;border:1px solid var(--cc-line);border-radius:4px;background:var(--cc-surface);font:700 13px var(--cc-font-c);cursor:pointer;color:var(--cc-text)}',
        '.gt-editor-codes button.abs{font-weight:600;font-size:11.5px;color:var(--cc-muted)}',
        '.gt-editor-codes button.on{background:var(--cc-accent);border-color:var(--cc-accent);color:#fff}',
        '.gt-editor-cov{display:flex;gap:8px;align-items:center;font-size:13px;margin-top:4px}.gt-editor-cov select{height:30px}',
        '.gt-lock{display:inline-flex;align-items:center;gap:4px;font:600 11.5px var(--cc-font);color:#b45309;background:#fef3c7;border-radius:4px;padding:3px 8px}.gt-lock .material-icons-round{font-size:15px}',
        '.gt-ops{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}',
        '.gt-op{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--cc-line);border-radius:999px;padding:5px 6px 5px 12px;font-size:13px}.gt-op small{color:var(--cc-muted);font-size:11px}',
        '.gt-op-x{border:0;background:var(--cc-surface-2);border-radius:50%;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;color:var(--cc-muted)}.gt-op-x .material-icons-round{font-size:14px}',
        '.gt-ops-actions{display:flex;gap:8px;margin-bottom:10px}',
        '.gt-reqs li{align-items:flex-start;flex-wrap:wrap}.gt-res{display:block;margin-top:6px;padding:6px 8px;border-left:3px solid var(--cc-accent);background:var(--cc-surface-2);border-radius:0 4px 4px 0}',
        '@media (max-width:640px){.gt-rules{grid-template-columns:1fr;padding:10px}.gt .gt-cal tbody td.gt-c{min-width:58px}.gt-year button{padding:8px 12px}}'
    ].join('\n');
    var stEl = document.createElement('style'); stEl.id = 'gt-style'; stEl.textContent = css; document.head.appendChild(stEl);
})();
