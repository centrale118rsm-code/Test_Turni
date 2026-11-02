/*
 * ══════════════════════════════════════════════════════════════════════════
 *  AREA TEST — SEGRETARIO PARTICOLARE (assistente Claude per i turni)
 * ══════════════════════════════════════════════════════════════════════════
 *  Area coordinatore › Area test › "Segretario particolare".
 *  Il coordinatore inserisce la SUA chiave API di Claude: resta solo nel
 *  browser (localStorage), non va su GitHub né nel database finto.
 *  Si chatta con il segretario dalla bolla in basso a destra: legge il
 *  calendario, risponde sui turni e li modifica con gli stessi strumenti della
 *  modalità "Modifica turni" (modifiche in sospeso, annullabili, da salvare).
 *
 *  ATTENZIONE: la chiave sta nel browser e le chiamate partono dal browser.
 *  Chi ha accesso al dispositivo (o un'estensione del browser) può leggerla.
 *  Usare una chiave dedicata, con limite di spesa, e cancellarla quando non serve.
 * ══════════════════════════════════════════════════════════════════════════
 */
(function () {
    'use strict';

    var SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.135.0/+esm';
    var MODEL = 'claude-opus-5-5';
    var KEY_STORE = 'seg_api_key', CHAT_STORE = 'seg_chat_v1';
    var MAX_STEPS = 16;

    var SEG = window.SEG = { busy: false, open: false, api: [], view: [], sdk: null, noFallback: false };

    // ───────────────────────── utilità ─────────────────────────
    function h(s) { return (s === undefined || s === null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch (e) { return false; } }
    function getKey() { return (lsGet(KEY_STORE) || '').trim(); }
    function toast(m, err) { if (typeof ccToast === 'function') ccToast(m, err); }
    function pad(n) { return String(n).padStart(2, '0'); }
    function isoOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function dateOf(iso) { var p = iso.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 12); }
    function addDays(iso, n) { var d = dateOf(iso); d.setDate(d.getDate() + n); return isoOf(d); }
    var WD = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
    function isIso(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && isoOf(dateOf(s)) === s; }
    function norm(n) { return String(n || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, ''); }
    function fail(msg) { var e = new Error(msg); e.toolError = true; throw e; }
    function loggedIn() { return typeof isCoordLoggedIn === 'function' && isCoordLoggedIn(); }

    // ───────────────────────── calendario ─────────────────────────
    function ready() { if (typeof finalData === 'undefined' || !finalData.length || typeof drivers === 'undefined') fail('Il calendario non è ancora caricato: riprova tra un attimo.'); }
    function findOp(name) {
        var n = norm(name); if (!n) fail('Manca il nome dell’operatore.');
        var list = drivers.slice();
        var hit = list.filter(function (d) { return norm(d.name) === n || norm(d.originalName) === n; });
        if (!hit.length) hit = list.filter(function (d) { return norm(d.name).indexOf(n) === 0 || norm(d.originalName).indexOf(n) === 0; });
        if (!hit.length) hit = list.filter(function (d) { return norm(d.name).indexOf(n) >= 0 || norm(d.originalName).indexOf(n) >= 0; });
        if (hit.length === 1) return hit[0];
        if (!hit.length) fail('Non trovo l’operatore "' + name + '". Operatori: ' + list.map(function (d) { return d.name; }).join(', '));
        fail('"' + name + '" è ambiguo: ' + hit.map(function (d) { return d.name; }).join(', '));
    }
    function rowOf(iso) {
        if (!isIso(iso)) fail('Data non valida: "' + iso + '" (usa AAAA-MM-GG).');
        var r = repRowOfDate(iso);
        if (!r) fail('Il ' + iso + ' non è nel calendario aperto (anno ' + SHIFT_YEAR + '). Per un altro anno bisogna cambiarlo da menu › Anno.');
        return r;
    }
    function holiday(iso) { var d = dateOf(iso); return d.getDay() === 0 || !!(typeof HOLIDAYS !== 'undefined' && HOLIDAYS[d.getMonth() + '-' + d.getDate()]); }
    // casella → { code, abs, txt }
    function cellOf(row, col) {
        var c = (finalData[row] && finalData[row][col]) || {};
        var sub = String(c.subV || '').trim().toLowerCase();
        var v = String(c.v || '').split('/')[0].trim(); if (v === '-') v = '';
        var out = { code: v, abs: '', txt: v || '·' };
        if (sub && SPECIAL_SUBCODES[sub] !== undefined) { out.abs = sub; out.code = ''; out.txt = 'ASSENZA ' + sub + ' (' + SPECIAL_SUBCODES[sub] + ')'; }
        else if (v && typeof customCodes !== 'undefined' && customCodes[v.toUpperCase()] && customCodes[v.toUpperCase()].kind === 'abs') { out.abs = v; out.txt = 'ASSENZA ' + v; }
        if (c.customMinutes !== undefined && c.customMinutes !== null && c.customMinutes !== '') out.txt += ' (straordinario ' + c.customMinutes + 'h)';
        if (c.overridden) out.txt += ' *';
        return out;
    }
    function isMorning(v) { return v === 'M' || v === 'm' || v === 'M+N' || v === 'G'; }
    function isAfternoon(v) { return v === 'P' || v === 'p' || v === 'G'; }
    function isNight(v) { return v === 'N' || v === 'M+N'; }
    function repOn(iso) { try { return (repData().tit[iso]) || ''; } catch (e) { return ''; } }
    function nameOfOrig(orig) { var d = drivers.filter(function (x) { return x.originalName === orig; })[0]; return d ? d.name : orig; }

    function dayLine(iso, ops) {
        var r = rowOf(iso), m = 0, p = 0, n = 0, parts = [];
        drivers.forEach(function (d) {
            var c = cellOf(r, d.idx);
            if (!c.abs) { if (isMorning(c.code)) m++; if (isAfternoon(c.code)) p++; if (isNight(c.code)) n++; }
            if (!ops || ops.indexOf(d) >= 0) parts.push(d.name + ': ' + c.txt);
        });
        var rep = repOn(iso);
        return iso + ' ' + WD[dateOf(iso).getDay()] + (holiday(iso) ? ' (festivo)' : '') + ' | ' + parts.join(' | ') +
            ' | reperibile (dalle 13 per 24h): ' + (rep ? nameOfOrig(rep) : 'nessuno') + ' | copertura M' + m + ' P' + p + ' N' + n;
    }

    // ───────────────────────── strumenti ─────────────────────────
    function ensureEdit() {
        if (typeof isViewingArchive === 'function' && isViewingArchive()) fail('Questo anno è archiviato: si può solo consultare.');
        if (!coordEditModeActive) toggleCoordEditMode(true);
    }
    function describeKey(idx, key) {
        var p = idx.get(key); if (!p) return key;
        var d = getDriverByIdx(p.col); return repRowDate(p.row) + ' ' + (d ? d.name : '?') + ' → ' + cellOf(p.row, p.col).txt;
    }
    function withAuto(on, fn) {
        var prev = lsGet('gt_auto_edit');
        if (on) lsSet('gt_auto_edit', '1'); else lsSet('gt_auto_edit', null);
        try { return fn(); } finally { lsSet('gt_auto_edit', prev); }
    }

    var TOOLS = {
        info_generali: {
            description: 'Dati di base: data di oggi, anno aperto nel calendario, elenco operatori (nome, ore di contratto), codici dei turni e delle assenze, modifiche in sospeso. Chiamalo all’inizio se non conosci gli operatori.',
            schema: { type: 'object', properties: {}, additionalProperties: false },
            run: function () {
                ready();
                var codes = wheelPaletteItems().map(function (i) { return (i.subV ? 'assenza ' + i.subV : i.v) + ' = ' + i.label + (i.time ? ' (' + i.time + ')' : ''); });
                return {
                    oggi: isoOf(new Date()) + ' ' + WD[new Date().getDay()],
                    anno_aperto: SHIFT_YEAR,
                    anno_di_lavoro: typeof activeYear !== 'undefined' ? activeYear : SHIFT_YEAR,
                    sola_lettura: typeof isViewingArchive === 'function' && isViewingArchive(),
                    modalita_modifica_attiva: !!coordEditModeActive,
                    modifiche_da_salvare: typeof pendingChangesCount === 'function' ? pendingChangesCount() : 0,
                    operatori: drivers.map(function (d) { return { nome: d.name, ore_settimanali: getContractHours(d.idx), nascosto: !!d.hidden, aggiunto: !!d.virtual }; }),
                    codici: codes,
                    note: 'Maiuscole = turnista (M mattina, P pomeriggio, N notte, S/SM smonto, R riposo), minuscole = diurnista (m, p, r). Una casella con * è stata cambiata nell’app.'
                };
            }
        },
        leggi_turni: {
            description: 'Legge il calendario giorno per giorno (massimo 62 giorni per chiamata): turno o assenza di ogni operatore, reperibile e copertura (quanti di mattina, pomeriggio, notte). Include le modifiche non ancora salvate.',
            schema: {
                type: 'object', additionalProperties: false, required: ['dal', 'al'],
                properties: {
                    dal: { type: 'string', description: 'Primo giorno, AAAA-MM-GG' },
                    al: { type: 'string', description: 'Ultimo giorno, AAAA-MM-GG' },
                    operatori: { type: 'array', items: { type: 'string' }, description: 'Solo questi operatori (facoltativo)' }
                }
            },
            run: function (a) {
                ready();
                if (!isIso(a.dal) || !isIso(a.al)) fail('Date non valide (usa AAAA-MM-GG).');
                if (a.al < a.dal) fail('"al" viene prima di "dal".');
                var ops = a.operatori && a.operatori.length ? a.operatori.map(findOp) : null, out = [], n = 0;
                for (var iso = a.dal; iso <= a.al; iso = addDays(iso, 1)) { if (++n > 62) { out.push('… (troncato a 62 giorni: chiedi il resto con un’altra chiamata)'); break; } out.push(dayLine(iso, ops)); }
                return out.join('\n');
            }
        },
        modifica_turni: {
            description: 'Cambia una o più caselle del calendario in un colpo solo (un solo passo di annullamento). Per ogni casella indica o un turno ("turno") o un’assenza ("assenza"), oppure svuota=true. Le modifiche restano in sospeso finché non vengono salvate. Con copertura_automatica=true, per le nuove assenze l’app cerca da sola chi copre e sposta la reperibilità se serve (stessa logica della ruota in modalità Auto).',
            schema: {
                type: 'object', additionalProperties: false, required: ['modifiche'],
                properties: {
                    modifiche: {
                        type: 'array', minItems: 1, maxItems: 120,
                        items: {
                            type: 'object', additionalProperties: false, required: ['data', 'operatore'],
                            properties: {
                                data: { type: 'string', description: 'AAAA-MM-GG' },
                                operatore: { type: 'string' },
                                turno: { type: 'string', description: 'Codice turno: M, P, N, S, R, m, p, r, M+N o un codice personalizzato (es. G)' },
                                assenza: { type: 'string', description: 'Codice assenza: f (C.O./ferie), v (ferie residue), m (malattia), p (permesso), r (recupero), pn (permesso notte), c, ng, nl, z, e, l, s, a, k, pl, ps' },
                                svuota: { type: 'boolean', description: 'true = casella vuota' }
                            }
                        }
                    },
                    copertura_automatica: { type: 'boolean', description: 'true = per le assenze nuove trova da solo i sostituti' }
                }
            },
            run: function (a) {
                ready();
                if (!Array.isArray(a.modifiche) || !a.modifiche.length) fail('Nessuna modifica indicata.');
                var codes = {}; STANDARD_CODES.concat(DIURNI_CODES, ['M+N', 'S']).forEach(function (c) { codes[c] = c; });
                Object.keys(customCodes || {}).forEach(function (c) { codes[c] = c; });
                var list = [], seen = {};
                a.modifiche.forEach(function (m, i) {
                    var row = rowOf(m.data), d = findOp(m.operatore), col = d.idx, next;
                    if (m.svuota) next = { v: '', subV: '' };
                    else if (m.assenza) {
                        var s = String(m.assenza).trim().toLowerCase();
                        if (SPECIAL_SUBCODES[s] === undefined) fail('Assenza "' + m.assenza + '" sconosciuta. Codici: ' + Object.keys(SPECIAL_SUBCODES).join(', '));
                        next = { v: '', subV: s };
                    } else if (m.turno) {
                        var t = String(m.turno).trim(), u = codes[t] || codes[t.toUpperCase()];
                        if (/^[mpr]$/.test(t)) u = t;
                        if (!u) fail('Turno "' + m.turno + '" sconosciuto. Codici: ' + Object.keys(codes).join(', '));
                        next = { v: u, subV: '' };
                    } else fail('Modifica ' + (i + 1) + ': indica turno, assenza o svuota.');
                    var key = cellKey(row, col); if (seen[key]) fail('La casella ' + m.data + ' di ' + d.name + ' compare due volte.'); seen[key] = 1;
                    list.push({ key: key, next: next, row: row, col: col });
                });
                ensureEdit();
                var done = absApplyChecked(list);
                if (!done) fail('Modifica rifiutata dall’app: supererebbe le spettanze (C.O./permessi) dell’operatore. Niente è stato cambiato.');
                var entries = done.map(function (x) { return { key: x.key, prev: x.prev, next: x.next }; });
                afterCoordChange(entries.map(function (x) { return x.key; }));
                var auto = [];
                if (a.copertura_automatica && typeof gtAutoAfterEdit === 'function') auto = withAuto(true, function () { return gtAutoAfterEdit(entries); }) || [];
                pushUndo({ entries: entries.concat(auto) });
                var idx = coordKeyIndex();
                var res = { fatto: entries.map(function (e) { return describeKey(idx, e.key); }) };
                if (auto.length) res.automatiche = auto.map(function (e) { return e.kind === 'rep' ? 'reperibilità ' + e.key + ' → ' + (e.next && e.next.v ? nameOfOrig(e.next.v) : 'nessuno') : describeKey(idx, e.key); });
                else if (a.copertura_automatica) res.automatiche = 'nessuna sostituzione trovata o necessaria';
                res.da_salvare = pendingChangesCount();
                return res;
            }
        },
        imposta_reperibilita: {
            description: 'Assegna la reperibilità di un giorno (dalle 13:00 di quel giorno alle 13:00 del giorno dopo) a un operatore, oppure la toglie (operatore vuoto). Resta in sospeso finché non si salva.',
            schema: {
                type: 'object', additionalProperties: false, required: ['data', 'operatore'],
                properties: { data: { type: 'string', description: 'AAAA-MM-GG' }, operatore: { type: 'string', description: 'Nome, oppure "" per togliere la reperibilità' } }
            },
            run: function (a) {
                ready(); rowOf(a.data);
                var d = a.operatore ? findOp(a.operatore) : null, tit = repOn(a.data), entries = [];
                ensureEdit();
                if (d && tit === d.originalName) return d.name + ' è già reperibile il ' + a.data + '.';
                if (tit) repClearTurnCessioni(a.data, entries);
                entries.push(repChange('rep', a.data, d ? d.originalName : ''));
                if (!repCommitEntries(entries, d ? 'Reperibilità ' + a.data + ': ' + d.name : 'Reperibilità ' + a.data + ' tolta')) return 'Nessun cambiamento.';
                var res = { fatto: 'reperibilità ' + a.data + ': ' + (tit ? nameOfOrig(tit) : 'nessuno') + ' → ' + (d ? d.name : 'nessuno'), da_salvare: pendingChangesCount() }, warn = [];
                if (d) {
                    var r0 = rowOf(a.data), c0 = cellOf(r0, d.idx), nx = addDays(a.data, 1), r1 = repRowOfDate(nx), c1 = r1 ? cellOf(r1, d.idx) : null;
                    if (c0.abs) warn.push(d.name + ' quel giorno è assente');
                    if (c1 && c1.abs) warn.push(d.name + ' il giorno dopo è assente');
                    else if (c1 && isMorning(c1.code)) warn.push(d.name + ' il giorno dopo fa la mattina: la reperibilità finisce alle 13, dovrebbe fare pomeriggio o notte');
                }
                if (warn.length) res.attenzione = warn;
                return res;
            }
        },
        conteggio_ore: {
            description: 'Ore lavorate e ore dovute da contratto per operatore in un periodo dell’anno aperto (stesso calcolo della sezione Conteggio ore).',
            schema: {
                type: 'object', additionalProperties: false, required: ['dal', 'al'],
                properties: { dal: { type: 'string' }, al: { type: 'string' }, operatori: { type: 'array', items: { type: 'string' } } }
            },
            run: function (a) {
                ready();
                if (!isIso(a.dal) || !isIso(a.al)) fail('Date non valide (usa AAAA-MM-GG).');
                var days = buildDaysIndex().filter(function (dd) { var i = isoOf(dd.date); return i >= a.dal && i <= a.al; });
                if (!days.length) fail('Nessun giorno di quel periodo nel calendario aperto (anno ' + SHIFT_YEAR + ').');
                var ops = a.operatori && a.operatori.length ? a.operatori.map(findOp) : drivers;
                function hm(min) { var s = min < 0 ? '-' : ''; min = Math.abs(Math.round(min)); return s + Math.floor(min / 60) + 'h' + pad(min % 60); }
                return ops.map(function (d) {
                    var min = 0; days.forEach(function (dd) { min += computeDayInfo(dd.rowIdx, d.idx).minutes || 0; });
                    var target = contractMinutesFor(getContractHours(d.idx), days.map(function (dd) { return dd.date; }), d.idx);
                    return d.name + ': lavorate ' + hm(min) + ', dovute ' + hm(target) + ', differenza ' + hm(min - target);
                }).join('\n');
            }
        },
        annulla_ultima_modifica: {
            description: 'Annulla l’ultima modifica in sospeso (come il tasto Annulla della ruota).',
            schema: { type: 'object', properties: {}, additionalProperties: false },
            run: function () { if (!coordUndoStack.length) return 'Non c’è niente da annullare.'; coordUndo(); return { fatto: 'annullata', da_salvare: pendingChangesCount() }; }
        },
        salva_modifiche: {
            description: 'Salva tutte le modifiche in sospeso, che diventano visibili a tutti (nell’area test: nel database finto). Usalo SOLO quando l’utente ti chiede esplicitamente di salvare.',
            schema: { type: 'object', properties: {}, additionalProperties: false },
            run: async function () {
                var n = pendingChangesCount(); if (!n) return 'Non c’è niente da salvare.';
                var ok = await saveAllPendingChanges(true);
                return ok ? 'Salvate ' + n + ' modifiche.' : 'Salvataggio non riuscito (vedi messaggio nell’app).';
            }
        },
        mostra_nel_calendario: {
            description: 'Chiude l’area coordinatore e porta il calendario sul giorno indicato, così l’utente vede le caselle.',
            schema: { type: 'object', additionalProperties: false, required: ['data'], properties: { data: { type: 'string' } } },
            run: function (a) {
                ready(); var r = rowOf(a.data);
                if (typeof closeCoordConsole === 'function') closeCoordConsole();
                setTimeout(function () { var td = document.querySelector('td[data-row="' + r + '"]'); if (td) td.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 250);
                return 'Calendario sul ' + a.data + '.';
            }
        },
        genera_anno: {
            description: 'Usa il generatore automatico (sezione Generazione turni) per creare l’anno indicato con le regole impostate lì. Lavoro grosso: chiedi conferma all’utente prima. Se l’anno era già generato l’app chiede conferma per rigenerarlo.',
            schema: { type: 'object', additionalProperties: false, required: ['anno'], properties: { anno: { type: 'integer' } } },
            run: async function (a) {
                if (!window.GT || typeof GT.generate !== 'function') fail('Generatore non disponibile.');
                var y = Number(a.anno); if (!(y >= 2026 && y <= 2035)) fail('Anno non valido.');
                if (typeof ccGo === 'function') ccGo('generazione');
                GT.setYear(y);
                await GT.generate();
                if (!GT.plan || GT.plan.year !== y) return 'Generazione non fatta (annullata o non riuscita).';
                return 'Anno ' + y + ' generato dal ' + GT.plan.firstGenerated + '. Si vede nella sezione Generazione turni; per lavorarci nel calendario: menu › Anno › ' + y + '.';
            }
        }
    };
    function toolDefs() {
        return Object.keys(TOOLS).map(function (k) { return { name: k, description: TOOLS[k].description, input_schema: TOOLS[k].schema, eager_input_streaming: true }; });
    }
    SEG._t = TOOLS;
    var TOOL_LABEL = { info_generali: 'Guardo chi c’è', leggi_turni: 'Leggo i turni', modifica_turni: 'Modifico i turni', imposta_reperibilita: 'Sistemo la reperibilità', conteggio_ore: 'Conto le ore', annulla_ultima_modifica: 'Annullo', salva_modifiche: 'Salvo', mostra_nel_calendario: 'Apro il calendario', genera_anno: 'Genero l’anno' };

    // ───────────────────────── prompt ─────────────────────────
    function systemPrompt() {
        var who = '';
        try { who = (typeof coordinatorName !== 'undefined' && coordinatorName) ? String(coordinatorName) : ''; } catch (e) {}
        return [
            'Sei il "segretario particolare" del coordinatore dei turni degli autisti soccorritori della centrale 118 (app turni, versione AREA TEST: i dati sono finti, nel browser). Parli sempre in italiano.',
            who ? 'Il coordinatore si chiama ' + who + '.' : '',
            'Oggi è ' + new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ' (' + isoOf(new Date()) + ').',
            '',
            'CARATTERE: sei simpatico, scherzoso, un po’ sfacciato. Dai del tu. Ogni tanto prendi in giro il coordinatore con affetto (per le richieste all’ultimo minuto, per i turni che cambia tre volte, per il caffè che di sicuro ha in mano…), ma senza mai essere offensivo e senza esagerare: una battuta ogni tanto, non in ogni frase. Quando si parla di turni sei preciso e affidabile: lo scherzo non deve mai rendere ambigua un’informazione. Risposte brevi, da chat; elenchi solo quando servono.',
            '',
            'COSA PUOI FARE: con gli strumenti leggi il calendario, conti le ore, modifichi caselle e reperibilità, annulli, salvi, porti il calendario su un giorno, lanci il generatore annuale. Non inventare mai turni: se non li hai letti, leggili.',
            '',
            'REGOLE DEI TURNI (da tenere d’occhio quando proponi o fai modifiche, e da segnalare se una richiesta le viola):',
            '- Copertura di ogni giorno: 2 di mattina, 2 di pomeriggio, 1 di notte.',
            '- Turnisti (maiuscole) a ciclo; diurnisti (minuscole m/p/r). 36 ore a settimana.',
            '- Dopo una notte (N) sempre smonto (S) e poi riposo, anche per chi copre una notte non sua.',
            '- Mai 7 giorni di lavoro di fila. Riposi settimanali da rispettare.',
            '- La reperibilità va dalle 13:00 alle 13:00 del giorno dopo: il giorno dopo il reperibile fa pomeriggio o notte, mai la mattina.',
            '- Al massimo 2 persone in ferie nello stesso giorno.',
            '',
            'COME LAVORI:',
            '- Le modifiche restano IN SOSPESO (si vedono nel calendario con l’asterisco) finché non vengono salvate. Salva solo quando l’utente lo chiede esplicitamente; dopo una modifica ricordagli che va salvata.',
            '- Prima di cambiare più di una decina di caselle, o di generare un anno, riassumi cosa farai e chiedi conferma.',
            '- Se una richiesta è ambigua (quale operatore, quale giorno), chiedi. Se manca l’anno, intendi l’anno aperto nel calendario.',
            '- Dopo una modifica dì in breve cosa hai cambiato e se la copertura o le regole ne risentono.',
            '- Le date per gli strumenti sono AAAA-MM-GG; all’utente scrivile in modo naturale (es. "martedì 5 gennaio").'
        ].join('\n').replace('dì', 'dì');
    }

    // ───────────────────────── Claude ─────────────────────────
    async function client() {
        if (!SEG.sdk) {
            var mod = await import(SDK_URL);
            SEG.sdk = mod.default || mod.Anthropic;
        }
        return new SEG.sdk({ apiKey: getKey(), dangerouslyAllowBrowser: true, maxRetries: 2 });
    }
    function params() {
        var p = {
            model: MODEL, max_tokens: 16000,
            system: systemPrompt(),
            thinking: { type: 'adaptive' },
            output_config: { effort: 'medium' },
            cache_control: { type: 'ephemeral' },
            tools: toolDefs(),
            messages: SEG.api
        };
        if (!SEG.noFallback) { p.betas = ['server-side-fallback-2026-07-01']; p.fallbacks = 'default'; }
        return p;
    }
    async function runTool(tu) {
        var t = TOOLS[tu.name];
        if (!t) return { type: 'tool_result', tool_use_id: tu.id, content: 'Strumento sconosciuto: ' + tu.name, is_error: true };
        var input = tu.input;
        if (!input || typeof input !== 'object' || Array.isArray(input)) return { type: 'tool_result', tool_use_id: tu.id, content: 'INVALID_JSON: parametri non validi, riprova.', is_error: true };
        try {
            var out = await t.run(input);
            return { type: 'tool_result', tool_use_id: tu.id, content: typeof out === 'string' ? out : JSON.stringify(out) };
        } catch (e) {
            if (!e.toolError) console.error(e);
            return { type: 'tool_result', tool_use_id: tu.id, content: 'Errore: ' + (e.message || e), is_error: true };
        }
    }
    function errText(e) {
        var s = e && (e.status || (e.error && e.error.status));
        if (s === 401) return 'La chiave API non è valida (401). Controllala nella sezione Segretario particolare.';
        if (s === 403) return 'La chiave non ha accesso a questo modello (403).';
        if (s === 429) return 'Troppe richieste o credito finito (429). Riprova tra poco o controlla il credito su console.anthropic.com.';
        if (s === 529 || s === 503) return 'I server di Claude sono sovraccarichi: riprova tra un minuto.';
        if (e && /Failed to fetch|NetworkError|import/i.test(String(e.message))) return 'Non riesco a raggiungere Claude (rete assente o bloccata).';
        return 'Errore: ' + ((e && e.message) || e);
    }

    async function send(text) {
        if (SEG.busy) return;
        text = String(text || '').trim(); if (!text) return;
        if (!getKey()) { addView({ role: 'sys', text: 'Prima inserisci la tua chiave API nella sezione "Segretario particolare" dell’area coordinatore.' }); return; }
        SEG.busy = true;
        var startLen = SEG.api.length;
        SEG.api.push({ role: 'user', content: text });
        addView({ role: 'user', text: text });
        var bubble = addView({ role: 'bot', text: '', live: true });
        renderChat();
        try {
            var c = await client();
            for (var step = 0; step < MAX_STEPS; step++) {
                var msg;
                try { msg = await streamOnce(c, bubble); }
                catch (e) {
                    if (!SEG.noFallback && e && e.status === 400 && /fallback/i.test(String(e.message))) { SEG.noFallback = true; msg = await streamOnce(c, bubble); }
                    else throw e;
                }
                SEG.api.push({ role: 'assistant', content: msg.content });
                if (msg.stop_reason === 'refusal') { bubble.text += (bubble.text ? '\n\n' : '') + '(Su questa richiesta non posso aiutarti.)'; break; }
                if (msg.stop_reason === 'max_tokens') { bubble.text += '\n\n(Risposta troppo lunga, interrotta.)'; break; }
                if (msg.stop_reason === 'pause_turn') continue;
                var uses = msg.content.filter(function (b) { return b.type === 'tool_use'; });
                if (msg.stop_reason !== 'tool_use' || !uses.length) break;
                var results = [];
                for (var i = 0; i < uses.length; i++) {
                    bubble.tools.push(TOOL_LABEL[uses[i].name] || uses[i].name); renderChat();
                    results.push(await runTool(uses[i]));
                }
                SEG.api.push({ role: 'user', content: results });
                if (bubble.text && !/\n\n$/.test(bubble.text)) bubble.text += '\n\n';
            }
        } catch (e) {
            console.error(e);
            // se la richiesta non è partita, la conversazione torna com'era (niente messaggi senza risposta)
            if (SEG.api.length === startLen + 1) SEG.api.length = startLen;
            bubble.text += (bubble.text ? '\n\n' : '') + '⚠️ ' + errText(e);
            bubble.err = true;
        } finally {
            bubble.live = false; SEG.busy = false;
            if (!bubble.text.trim()) bubble.text = '…';
            saveChat(); renderChat();
            if (typeof ccRefreshIfOpen === 'function') try { ccRefreshIfOpen(); } catch (e) {}
        }
    }
    async function streamOnce(c, bubble) {
        var base = bubble.text;
        var stream = c.beta.messages.stream(params());
        stream.on('text', function (d) { bubble.text += d; renderLive(bubble); });
        try { return await stream.finalMessage(); }
        catch (e) { bubble.text = base; throw e; }
    }

    // ───────────────────────── memoria della chat ─────────────────────────
    function addView(v) { v.tools = v.tools || []; SEG.view.push(v); return v; }
    function saveChat() {
        if (!lsSet(CHAT_STORE, JSON.stringify({ api: SEG.api, view: SEG.view.map(function (v) { return { role: v.role, text: v.text, tools: v.tools, err: v.err }; }) }))) {
            // memoria piena: si tiene solo la vista
            lsSet(CHAT_STORE, null);
        }
    }
    function loadChat() {
        try { var o = JSON.parse(lsGet(CHAT_STORE) || 'null'); if (o && Array.isArray(o.api)) { SEG.api = o.api; SEG.view = o.view || []; } } catch (e) {}
        // una conversazione deve finire con la risposta dell'assistente
        while (SEG.api.length && SEG.api[SEG.api.length - 1].role === 'user') SEG.api.pop();
    }
    SEG.newChat = function () {
        if (SEG.busy) return;
        SEG.api = []; SEG.view = []; saveChat(); renderChat();
        var i = document.getElementById('seg-in'); if (i) i.focus();
    };

    // ───────────────────────── interfaccia ─────────────────────────
    var CSS = '' +
        '#seg-fab{position:fixed;right:16px;bottom:calc(132px + env(safe-area-inset-bottom,0px));z-index:9590;width:54px;height:54px;border-radius:50%;border:0;cursor:pointer;display:none;align-items:center;justify-content:center;font-size:26px;background:linear-gradient(135deg,#1d4ed8,#7c3aed);color:#fff;box-shadow:0 10px 24px -6px rgba(29,78,216,.55)}' +
        '#seg-fab.show{display:flex}#seg-fab:active{transform:scale(.95)}' +
        '#seg-fab .seg-dot{position:absolute;top:4px;right:4px;width:11px;height:11px;border-radius:50%;background:#22c55e;border:2px solid #fff;display:none}#seg-fab.busy .seg-dot{display:block;animation:segPulse 1s infinite}' +
        '@keyframes segPulse{50%{opacity:.3}}' +
        '#seg-panel{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:9600;width:min(410px,calc(100vw - 32px));height:min(640px,calc(100vh - 120px));display:none;flex-direction:column;background:var(--cc-surface);color:var(--cc-text);border:1px solid var(--cc-line);border-radius:16px;box-shadow:0 24px 60px -16px rgba(15,23,42,.55);overflow:hidden}' +
        '#seg-panel.open{display:flex}' +
        '.seg-head{display:flex;align-items:center;gap:10px;padding:12px 12px 12px 14px;background:linear-gradient(135deg,#1d4ed8,#7c3aed);color:#fff}' +
        '.seg-ava{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-size:20px;flex:none}' +
        '.seg-head b{display:block;font-size:14.5px}.seg-head small{display:block;font-size:11.5px;opacity:.85}' +
        '.seg-head .seg-ib{margin-left:auto}.seg-ib{background:rgba(255,255,255,.14);border:0;color:#fff;width:32px;height:32px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none}.seg-ib:hover{background:rgba(255,255,255,.26)}' +
        '.seg-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:var(--cc-bg)}' +
        '.seg-m{max-width:86%;padding:9px 12px;border-radius:14px;font-size:13.8px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}' +
        '.seg-m.user{align-self:flex-end;background:var(--cc-accent);color:#fff;border-bottom-right-radius:4px}' +
        '.seg-m.bot{align-self:flex-start;background:var(--cc-surface);border:1px solid var(--cc-line);border-bottom-left-radius:4px}' +
        '.seg-m.bot.err{border-color:var(--cc-neg)}.seg-m.sys{align-self:center;background:var(--cc-warn-soft);color:var(--cc-warn);font-size:12.5px;text-align:center}' +
        '.seg-tools{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}.seg-tools span{font-size:11px;padding:2px 7px;border-radius:999px;background:var(--cc-accent-soft);color:var(--cc-accent)}' +
        '.seg-typing{display:inline-flex;gap:3px}.seg-typing i{width:6px;height:6px;border-radius:50%;background:var(--cc-muted);animation:segPulse 1s infinite}.seg-typing i:nth-child(2){animation-delay:.2s}.seg-typing i:nth-child(3){animation-delay:.4s}' +
        '.seg-foot{display:flex;gap:8px;padding:10px;border-top:1px solid var(--cc-line);background:var(--cc-surface)}' +
        '.seg-foot textarea{flex:1;resize:none;height:42px;max-height:120px;padding:10px 12px;border:1px solid var(--cc-line);border-radius:12px;background:var(--cc-surface);color:var(--cc-text);font:inherit;font-size:14px;outline:none}' +
        '.seg-foot textarea:focus{border-color:var(--cc-accent)}' +
        '.seg-send{width:42px;height:42px;border-radius:12px;border:0;background:var(--cc-accent);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center}.seg-send:disabled{opacity:.45;cursor:default}' +
        '.seg-empty{margin:auto;text-align:center;color:var(--cc-muted);font-size:13px;max-width:280px}.seg-empty .seg-big{font-size:40px;display:block;margin-bottom:6px}' +
        '.seg-chips{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:12px}.seg-chips button{border:1px solid var(--cc-line);background:var(--cc-surface);color:var(--cc-text);border-radius:999px;padding:6px 10px;font:inherit;font-size:12px;cursor:pointer}' +
        '.seg-card{background:var(--cc-surface);border:1px solid var(--cc-line);border-radius:var(--cc-r);padding:18px;max-width:720px;margin-bottom:16px}' +
        '.seg-card h3{margin:0 0 6px;font-size:16px}.seg-card p{margin:0 0 10px;color:var(--cc-muted);font-size:13.5px}' +
        '.seg-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.seg-row .cc-input{flex:1;min-width:220px}' +
        '.seg-warn{background:var(--cc-warn-soft);color:var(--cc-warn);border-radius:10px;padding:10px 12px;font-size:12.8px;margin-top:12px}' +
        '.seg-ok{color:var(--cc-pos);font-weight:600}' +
        '@media (max-width:640px){#seg-panel{right:0;left:0;bottom:0;width:100vw;height:calc(100dvh - 60px);border-radius:16px 16px 0 0}#seg-fab{right:12px}}';

    function mount() {
        if (document.getElementById('seg-panel')) return;
        var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
        var fab = document.createElement('button');
        fab.id = 'seg-fab'; fab.className = 'cc-scope'; fab.type = 'button'; fab.title = 'Segretario particolare';
        fab.innerHTML = '🕴️<span class="seg-dot"></span>'; fab.onclick = function () { SEG.toggle(); };
        document.body.appendChild(fab);
        var p = document.createElement('div');
        p.id = 'seg-panel'; p.className = 'cc-scope'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Segretario particolare');
        p.innerHTML =
            '<div class="seg-head"><div class="seg-ava">🕴️</div><div><b>Segretario particolare</b><small id="seg-status">al tuo servizio (più o meno)</small></div>' +
            '<button class="seg-ib" title="Nuova chat" onclick="SEG.newChat()"><span class="msym">add_comment</span></button>' +
            '<button class="seg-ib" style="margin-left:0" title="Chiudi" onclick="SEG.toggle(false)"><span class="msym">close</span></button></div>' +
            '<div class="seg-msgs" id="seg-msgs"></div>' +
            '<form class="seg-foot" onsubmit="event.preventDefault();SEG.submit()"><textarea id="seg-in" rows="1" placeholder="Chiedimi dei turni…" onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();SEG.submit()}"></textarea>' +
            '<button class="seg-send" id="seg-send" type="submit" title="Invia"><span class="msym">send</span></button></form>';
        document.body.appendChild(p);
        loadChat(); renderChat(); refreshFab();
        setInterval(refreshFab, 1500);
    }
    function refreshFab() {
        var fab = document.getElementById('seg-fab'); if (!fab) return;
        var show = loggedIn() && !!getKey();
        fab.classList.toggle('show', show && !SEG.open);
        fab.classList.toggle('busy', SEG.busy);
        if (!show && SEG.open && !loggedIn()) SEG.toggle(false);
    }
    SEG.toggle = function (on) {
        SEG.open = on === undefined ? !SEG.open : !!on;
        if (SEG.open && !loggedIn()) SEG.open = false;
        var p = document.getElementById('seg-panel'); if (!p) return;
        p.classList.toggle('open', SEG.open); refreshFab();
        if (SEG.open) { renderChat(); setTimeout(function () { var i = document.getElementById('seg-in'); if (i) i.focus(); }, 50); }
    };
    SEG.submit = function () {
        var i = document.getElementById('seg-in'); if (!i || SEG.busy) return;
        var t = i.value; i.value = ''; send(t);
    };
    SEG.ask = function (t) { send(t); };
    var SUGGEST = ['Chi è di notte questo fine settimana?', 'Metti Bianchi in ferie venerdì e trova chi copre', 'Come siamo messi con le ore questo mese?', 'Dimmi qualcosa di carino (se ci riesci)'];
    function fmt(text) {
        // grassetto **…** e a capo; il resto è testo semplice
        return h(text).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
    }
    function msgHtml(v) {
        if (v.role === 'user') return '<div class="seg-m user">' + h(v.text) + '</div>';
        if (v.role === 'sys') return '<div class="seg-m sys">' + h(v.text) + '</div>';
        var tools = v.tools && v.tools.length ? '<div class="seg-tools">' + v.tools.map(function (t) { return '<span>' + h(t) + '</span>'; }).join('') + '</div>' : '';
        var body = v.text ? fmt(v.text) : (v.live ? '<span class="seg-typing"><i></i><i></i><i></i></span>' : '');
        return '<div class="seg-m bot' + (v.err ? ' err' : '') + '">' + tools + '<span class="seg-txt">' + body + '</span></div>';
    }
    function renderChat() {
        var box = document.getElementById('seg-msgs'); if (!box) return;
        if (!SEG.view.length) {
            box.innerHTML = '<div class="seg-empty"><span class="seg-big">🕴️</span>Eccomi, capo. Chiedimi dei turni, fammi spostare qualcuno, o lamentati pure: sono pagato per ascoltare (anzi no, non sono pagato).' +
                '<div class="seg-chips">' + SUGGEST.map(function (s) { return '<button type="button" onclick="SEG.ask(this.textContent)">' + h(s) + '</button>'; }).join('') + '</div></div>';
        } else box.innerHTML = SEG.view.map(msgHtml).join('');
        box.scrollTop = box.scrollHeight;
        var sb = document.getElementById('seg-send'); if (sb) sb.disabled = SEG.busy;
        var s = document.getElementById('seg-status'); if (s) s.textContent = SEG.busy ? 'sto pensando…' : 'al tuo servizio (più o meno)';
        refreshFab();
    }
    var liveRaf = 0;
    function renderLive() { if (liveRaf) return; liveRaf = requestAnimationFrame(function () { liveRaf = 0; renderChat(); }); }

    // ───────────────────────── sezione dell'area coordinatore ─────────────────────────
    function renderSection() {
        var main = document.getElementById('cc-main'); if (!main) return;
        var k = getKey(), masked = k ? k.slice(0, 10) + '…' + k.slice(-4) : '';
        main.innerHTML =
            '<div class="seg-card"><h3>🕴️ Il tuo segretario particolare</h3>' +
            '<p>Un assistente Claude che legge il calendario, risponde sui turni e li modifica per te. Le modifiche che fa restano in sospeso (come in Modifica turni): le salva solo quando glielo chiedi. Ha un caratterino: ogni tanto ti prende in giro.</p>' +
            '<div class="seg-row">' + (k ? '<span class="seg-ok">Chiave inserita</span> <code>' + h(masked) + '</code>' : '<span>Nessuna chiave inserita.</span>') + '</div>' +
            '<div class="seg-row" style="margin-top:10px"><input id="seg-key" class="cc-input" type="password" autocomplete="off" placeholder="sk-ant-…" spellcheck="false">' +
            '<button class="cc-btn primary" onclick="SEG.saveKey()"><span class="msym">key</span>' + (k ? 'Sostituisci' : 'Salva chiave') + '</button>' +
            (k ? '<button class="cc-btn" onclick="SEG.removeKey()"><span class="msym">delete</span>Cancella</button>' : '') + '</div>' +
            '<div class="seg-warn"><b>Attenzione alla chiave.</b> Resta solo in questo browser (memoria del dispositivo): non va su GitHub né nel database. Però le richieste partono dal browser, quindi chi usa questo dispositivo o un’estensione del browser potrebbe leggerla. Usa una chiave creata apposta su console.anthropic.com, con un limite di spesa basso, e cancellala da qui quando hai finito. Ogni messaggio costa qualche centesimo.</div>' +
            '<div class="seg-row" style="margin-top:14px"><button class="cc-btn primary" onclick="SEG.toggle(true)"' + (k ? '' : ' disabled') + '><span class="msym">chat</span>Apri la chat</button>' +
            '<button class="cc-btn" onclick="SEG.newChat()"><span class="msym">restart_alt</span>Nuova conversazione</button></div>' +
            '<p style="margin-top:12px;font-size:12px">Modello: ' + MODEL + '. Puoi chiamarlo anche dal calendario con la bolla 🕴️ in basso a destra.</p></div>';
    }
    SEG.saveKey = function () {
        var i = document.getElementById('seg-key'), v = (i && i.value || '').trim();
        if (!/^sk-ant-/.test(v)) { toast('Non sembra una chiave di Claude (inizia con sk-ant-).', true); return; }
        lsSet(KEY_STORE, v); toast('Chiave salvata su questo dispositivo'); renderSection(); refreshFab();
    };
    SEG.removeKey = function () { lsSet(KEY_STORE, null); SEG.toggle(false); toast('Chiave cancellata da questo dispositivo'); renderSection(); refreshFab(); };

    function boot() {
        mount();
        if (typeof CC_SECTIONS !== 'undefined') CC_SECTIONS.segretario = { title: 'Segretario particolare', sub: 'Un assistente Claude con cui chattare dei turni: li legge, li modifica e ti prende pure in giro. Solo area test.' };
        window.GT_RENDER = window.GT_RENDER || {};
        window.GT_RENDER.segretario = renderSection;
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
