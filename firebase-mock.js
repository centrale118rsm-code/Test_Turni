/*
 * ══════════════════════════════════════════════════════════════════════════
 *  FIREBASE FINTO — SOLO PER L'AREA TEST
 * ══════════════════════════════════════════════════════════════════════════
 *  Questo file prende il posto delle librerie Firebase (app, auth, firestore).
 *  Offre gli stessi comandi che usa l'app (firebase.initializeApp, firestore(),
 *  collection/doc/get/set/update/delete/onSnapshot/where/orderBy/limit/batch,
 *  FieldValue, FieldPath, Timestamp, auth anonima) ma NON si collega a niente:
 *  i dati restano solo nel browser di chi usa l'app (localStorage, chiavi "TESTFB:").
 *
 *  Nessuna richiesta parte verso Google/Firebase: si può rompere tutto senza
 *  toccare i dati veri. Per ripartire da zero: pulsante "Azzera dati test"
 *  sulla bandella oppure, dalla console, window.__testFirebase.reset().
 * ══════════════════════════════════════════════════════════════════════════
 */
(function () {
    'use strict';
    if (window.firebase && window.firebase.__isTestMock) return;

    var PREFIX = 'TESTFB:';
    var LS = null;
    try { LS = window.localStorage; } catch (e) { LS = null; }

    // ── Timestamp ───────────────────────────────────────────────────────
    function Timestamp(seconds, nanoseconds) {
        this.seconds = Math.floor(seconds);
        this.nanoseconds = Math.floor(nanoseconds || 0);
    }
    Timestamp.fromMillis = function (ms) { ms = Number(ms) || 0; var s = Math.floor(ms / 1000); return new Timestamp(s, Math.round((ms - s * 1000) * 1e6)); };
    Timestamp.fromDate = function (d) { return Timestamp.fromMillis(d.getTime()); };
    Timestamp.now = function () { return Timestamp.fromMillis(Date.now()); };
    Timestamp.prototype.toMillis = function () { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); };
    Timestamp.prototype.toDate = function () { return new Date(this.toMillis()); };
    Timestamp.prototype.isEqual = function (o) { return o instanceof Timestamp && o.seconds === this.seconds && o.nanoseconds === this.nanoseconds; };
    Timestamp.prototype.valueOf = function () { return String(this.toMillis()).padStart(20, '0'); };
    Timestamp.prototype.toString = function () { return 'Timestamp(seconds=' + this.seconds + ', nanoseconds=' + this.nanoseconds + ')'; };
    Timestamp.prototype.toJSON = function () { return { seconds: this.seconds, nanoseconds: this.nanoseconds }; };

    // ── FieldValue / FieldPath ──────────────────────────────────────────
    function Sentinel(kind, arg) { this.__sentinel = kind; this.arg = arg; }
    var FieldValue = {
        delete: function () { return new Sentinel('delete'); },
        serverTimestamp: function () { return new Sentinel('serverTimestamp'); },
        arrayUnion: function () { return new Sentinel('arrayUnion', Array.prototype.slice.call(arguments)); },
        arrayRemove: function () { return new Sentinel('arrayRemove', Array.prototype.slice.call(arguments)); },
        increment: function (n) { return new Sentinel('increment', Number(n) || 0); }
    };
    var DOC_ID = '__name__';
    function FieldPath() { this.segments = Array.prototype.slice.call(arguments).map(String); }
    FieldPath.documentId = function () { return new FieldPath(DOC_ID); };
    FieldPath.prototype.isEqual = function (o) { return o instanceof FieldPath && o.segments.join('\u0000') === this.segments.join('\u0000'); };
    function toSegments(field) {
        if (field instanceof FieldPath) return field.segments.slice();
        return String(field).split('.');
    }

    // ── Codifica per il salvataggio (Timestamp e Date restano Timestamp) ──
    function encode(v) {
        if (v instanceof Timestamp) return { __ts: v.toMillis() };
        if (v instanceof Date) return { __ts: v.getTime() };
        if (Array.isArray(v)) return v.map(encode);
        if (v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { if (v[k] !== undefined) o[k] = encode(v[k]); }); return o; }
        return v;
    }
    function decode(v) {
        if (Array.isArray(v)) return v.map(decode);
        if (v && typeof v === 'object') {
            if (typeof v.__ts === 'number' && Object.keys(v).length === 1) return Timestamp.fromMillis(v.__ts);
            var o = {}; Object.keys(v).forEach(function (k) { o[k] = decode(v[k]); }); return o;
        }
        return v;
    }
    function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
    function isPlainObj(v) { return v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Timestamp) && !(v instanceof Date) && !(v instanceof Sentinel) && !(v instanceof FieldPath); }
    function sameVal(a, b) { return JSON.stringify(encode(a)) === JSON.stringify(encode(b)); }

    // ── Archivio (memoria + localStorage) ───────────────────────────────
    var store = new Map(); // path -> dati codificati
    var quotaWarned = false;
    function loadAll() {
        store.clear();
        if (!LS) return;
        try {
            for (var i = 0; i < LS.length; i++) {
                var k = LS.key(i);
                if (k && k.indexOf(PREFIX) === 0) {
                    try { store.set(k.slice(PREFIX.length), JSON.parse(LS.getItem(k))); } catch (e) {}
                }
            }
        } catch (e) {}
    }
    function persist(path, data) {
        if (!LS) return;
        try {
            if (data === undefined) LS.removeItem(PREFIX + path);
            else LS.setItem(PREFIX + path, JSON.stringify(data));
        } catch (e) {
            if (!quotaWarned) { quotaWarned = true; console.warn('[AREA TEST] Spazio del browser pieno: i dati di prova restano solo finché la pagina è aperta.', e); }
        }
    }
    loadAll();

    // ── Ascoltatori ─────────────────────────────────────────────────────
    var listeners = new Set();
    var notifyScheduled = false;
    function notifyAll() {
        if (notifyScheduled) return;
        notifyScheduled = true;
        setTimeout(function () {
            notifyScheduled = false;
            Array.from(listeners).forEach(function (l) { try { l.check(); } catch (e) { console.error(e); } });
        }, 0);
    }
    window.addEventListener('storage', function (ev) {
        if (!ev.key) { loadAll(); notifyAll(); return; }
        if (ev.key.indexOf(PREFIX) !== 0) return;
        var p = ev.key.slice(PREFIX.length);
        if (ev.newValue === null) store.delete(p);
        else { try { store.set(p, JSON.parse(ev.newValue)); } catch (e) {} }
        notifyAll();
    });

    var AUTO_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    function autoId() { var s = ''; for (var i = 0; i < 20; i++) s += AUTO_CHARS.charAt(Math.floor(Math.random() * AUTO_CHARS.length)); return s; }
    function err(code, msg) { var e = new Error(msg); e.code = code; e.name = 'FirebaseError'; return e; }
    var META = Object.freeze({ fromCache: false, hasPendingWrites: false, isEqual: function (o) { return !!o && o.fromCache === false && o.hasPendingWrites === false; } });

    // ── Applicazione delle scritture ────────────────────────────────────
    function resolveSentinel(cur, s) {
        switch (s.__sentinel) {
            case 'serverTimestamp': return Timestamp.now();
            case 'increment': return (typeof cur === 'number' ? cur : 0) + s.arg;
            case 'arrayUnion': { var a = Array.isArray(cur) ? cur.slice() : []; s.arg.forEach(function (x) { if (!a.some(function (y) { return sameVal(x, y); })) a.push(x); }); return a; }
            case 'arrayRemove': { var b = Array.isArray(cur) ? cur.slice() : []; return b.filter(function (y) { return !s.arg.some(function (x) { return sameVal(x, y); }); }); }
        }
        return undefined;
    }
    function setAt(obj, segs, value) {
        var o = obj;
        for (var i = 0; i < segs.length - 1; i++) {
            if (!isPlainObj(o[segs[i]])) {
                if (value instanceof Sentinel && value.__sentinel === 'delete') return;
                o[segs[i]] = {};
            }
            o = o[segs[i]];
        }
        var last = segs[segs.length - 1];
        if (value instanceof Sentinel) {
            if (value.__sentinel === 'delete') delete o[last];
            else o[last] = resolveSentinel(o[last], value);
        } else o[last] = resolveValue(value);
    }
    // sostituisce le sentinelle annidate (un valore scritto per intero)
    function resolveValue(v) {
        if (v instanceof Sentinel) return v.__sentinel === 'delete' ? undefined : resolveSentinel(undefined, v);
        if (Array.isArray(v)) return v.map(resolveValue);
        if (isPlainObj(v)) { var o = {}; Object.keys(v).forEach(function (k) { var r = resolveValue(v[k]); if (r !== undefined) o[k] = r; }); return o; }
        return v;
    }
    function deepMerge(target, src) {
        Object.keys(src).forEach(function (k) {
            var v = src[k];
            if (v === undefined) return;
            if (isPlainObj(v)) {
                if (!isPlainObj(target[k])) target[k] = {};
                deepMerge(target[k], v);
            } else setAt(target, [k], v);
        });
    }
    function mergeFieldsApply(target, src, fields) {
        fields.forEach(function (f) {
            var segs = toSegments(f), v = src;
            for (var i = 0; i < segs.length && v !== undefined; i++) v = v ? v[segs[i]] : undefined;
            if (v === undefined) setAt(target, segs, FieldValue.delete());
            else setAt(target, segs, v);
        });
    }
    function checkData(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw err('invalid-argument', 'Dati non validi: serve un oggetto.');
    }
    function writeSet(path, data, options) {
        checkData(data);
        var cur = store.has(path) ? decode(store.get(path)) : null;
        var next;
        if (options && options.merge && cur) { next = cur; deepMerge(next, data); }
        else if (options && options.mergeFields && cur) { next = cur; mergeFieldsApply(next, data, options.mergeFields); }
        else { next = resolveValue(data) || {}; }
        var enc = encode(next);
        store.set(path, enc); persist(path, enc);
    }
    function parseUpdateArgs(args) {
        if (args.length === 1 && args[0] && typeof args[0] === 'object' && !(args[0] instanceof FieldPath)) {
            var a = args[0];
            return Object.keys(a).map(function (k) { return [k.split('.'), a[k]]; });
        }
        var pairs = [];
        for (var i = 0; i + 1 < args.length; i += 2) pairs.push([toSegments(args[i]), args[i + 1]]);
        return pairs;
    }
    function writeUpdate(path, args) {
        if (!store.has(path)) throw err('not-found', 'No document to update: ' + path);
        var cur = decode(store.get(path));
        parseUpdateArgs(args).forEach(function (p) { setAt(cur, p[0], p[1]); });
        var enc = encode(cur);
        store.set(path, enc); persist(path, enc);
    }
    function writeDelete(path) { store.delete(path); persist(path, undefined); }

    // ── Istantanee ──────────────────────────────────────────────────────
    function getField(data, field) {
        var segs = toSegments(field), v = data;
        for (var i = 0; i < segs.length; i++) { if (v === null || v === undefined || typeof v !== 'object') return undefined; v = v[segs[i]]; }
        return v;
    }
    function DocumentSnapshot(ref, enc) {
        this.ref = ref; this.id = ref.id; this._enc = enc; this.exists = enc !== undefined; this.metadata = META;
    }
    DocumentSnapshot.prototype.data = function () { return this._enc === undefined ? undefined : decode(clone(this._enc)); };
    DocumentSnapshot.prototype.get = function (field) { if (this._enc === undefined) return undefined; var d = this.data(); return toSegments(field)[0] === DOC_ID ? this.id : getField(d, field); };
    DocumentSnapshot.prototype.isEqual = function (o) { return o instanceof DocumentSnapshot && o.ref.path === this.ref.path && JSON.stringify(o._enc) === JSON.stringify(this._enc); };

    function QuerySnapshot(query, docs, changes) {
        this.query = query; this.docs = docs; this.size = docs.length; this.empty = docs.length === 0; this.metadata = META; this._changes = changes;
    }
    QuerySnapshot.prototype.forEach = function (cb, thisArg) { this.docs.forEach(function (d) { cb.call(thisArg, d); }); };
    QuerySnapshot.prototype.docChanges = function () { return this._changes; };

    // ── Riferimenti ─────────────────────────────────────────────────────
    function Firestore(app) { this.app = app; this._sets = {}; }
    function DocumentReference(db, path) {
        this.firestore = db; this.path = path;
        var segs = path.split('/'); this.id = segs[segs.length - 1];
        this._colPath = segs.slice(0, -1).join('/');
    }
    Object.defineProperty(DocumentReference.prototype, 'parent', { get: function () { return new CollectionReference(this.firestore, this._colPath); } });
    DocumentReference.prototype.collection = function (name) { return new CollectionReference(this.firestore, this.path + '/' + name); };
    DocumentReference.prototype.isEqual = function (o) { return o instanceof DocumentReference && o.path === this.path; };
    DocumentReference.prototype._snap = function () { return new DocumentSnapshot(this, store.get(this.path)); };
    DocumentReference.prototype.get = function () { var self = this; return Promise.resolve().then(function () { return self._snap(); }); };
    DocumentReference.prototype.set = function (data, options) { var self = this; return Promise.resolve().then(function () { writeSet(self.path, data, options); notifyAll(); }); };
    DocumentReference.prototype.update = function () { var self = this, args = Array.prototype.slice.call(arguments); return Promise.resolve().then(function () { writeUpdate(self.path, args); notifyAll(); }); };
    DocumentReference.prototype.delete = function () { var self = this; return Promise.resolve().then(function () { writeDelete(self.path); notifyAll(); }); };
    DocumentReference.prototype.onSnapshot = function () {
        var self = this, h = parseListenArgs(arguments), last = null, active = true;
        var l = {
            check: function () {
                if (!active) return;
                var enc = store.get(self.path), key = enc === undefined ? '\u0000none' : JSON.stringify(enc);
                if (key === last) return;
                last = key;
                try { h.next(self._snap()); } catch (e) { console.error(e); }
            }
        };
        listeners.add(l);
        setTimeout(function () { l.check(); }, 0);
        return function () { active = false; listeners.delete(l); };
    };

    function parseListenArgs(args) {
        var a = Array.prototype.slice.call(args);
        if (a.length && a[0] && typeof a[0] === 'object' && typeof a[0].next !== 'function' && typeof a[0] !== 'function') a.shift(); // opzioni
        var first = a[0];
        if (first && typeof first === 'object') return { next: (first.next || function () {}).bind(first), error: (first.error || function () {}).bind(first) };
        return { next: first || function () {}, error: a[1] || function () {} };
    }

    function Query(db, colPath, filters, orders, lim, limLast) {
        this.firestore = db; this._colPath = colPath; this._filters = filters || []; this._orders = orders || []; this._limit = lim; this._limitLast = limLast;
    }
    Query.prototype._clone = function (patch) {
        var q = new Query(this.firestore, this._colPath, this._filters.slice(), this._orders.slice(), this._limit, this._limitLast);
        Object.keys(patch).forEach(function (k) { q[k] = patch[k]; });
        return q;
    };
    Query.prototype.where = function (field, op, value) { var f = this._filters.slice(); f.push({ field: field, op: op, value: value }); return this._clone({ _filters: f }); };
    Query.prototype.orderBy = function (field, dir) { var o = this._orders.slice(); o.push({ field: field, dir: dir === 'desc' ? 'desc' : 'asc' }); return this._clone({ _orders: o }); };
    Query.prototype.limit = function (n) { return this._clone({ _limit: n, _limitLast: undefined }); };
    Query.prototype.limitToLast = function (n) { return this._clone({ _limitLast: n, _limit: undefined }); };
    Query.prototype.startAt = Query.prototype.startAfter = Query.prototype.endAt = Query.prototype.endBefore = function () { console.warn('[AREA TEST] startAt/startAfter/endAt/endBefore non simulati: ignorati.'); return this; };
    Query.prototype.isEqual = function (o) { return o instanceof Query && o._colPath === this._colPath && JSON.stringify([o._filters, o._orders, o._limit]) === JSON.stringify([this._filters, this._orders, this._limit]); };

    function cmpVal(a, b) {
        if (a instanceof Timestamp || a instanceof Date) a = a instanceof Date ? a.getTime() : a.toMillis();
        if (b instanceof Timestamp || b instanceof Date) b = b instanceof Date ? b.getTime() : b.toMillis();
        if (a === b) return 0;
        if (a === undefined || a === null) return -1;
        if (b === undefined || b === null) return 1;
        var ta = typeof a, tb = typeof b;
        if (ta !== tb) { var order = ['boolean', 'number', 'string', 'object']; return order.indexOf(ta) - order.indexOf(tb); }
        if (ta === 'object') { var ja = JSON.stringify(a), jb = JSON.stringify(b); return ja < jb ? -1 : ja > jb ? 1 : 0; }
        return a < b ? -1 : a > b ? 1 : 0;
    }
    function typeClass(v) { if (v instanceof Timestamp || v instanceof Date) return 'ts'; return Array.isArray(v) ? 'array' : typeof v; }
    // come Firestore: i confronti < > valgono solo tra valori dello stesso tipo
    function rangeOk(v, x) { return v !== undefined && v !== null && typeClass(v) === typeClass(x); }
    function fieldOf(snap, field) { return toSegments(field)[0] === DOC_ID && toSegments(field).length === 1 ? snap.id : getField(snap.data(), field); }
    function filterMatch(snap, f) {
        var v = fieldOf(snap, f.field), x = f.value;
        if (x instanceof DocumentReference) x = x.id;
        switch (f.op) {
            case '==': return v !== undefined && cmpVal(v, x) === 0;
            case '!=': return v !== undefined && v !== null && cmpVal(v, x) !== 0;
            case '<': return rangeOk(v, x) && cmpVal(v, x) < 0;
            case '<=': return rangeOk(v, x) && cmpVal(v, x) <= 0;
            case '>': return rangeOk(v, x) && cmpVal(v, x) > 0;
            case '>=': return rangeOk(v, x) && cmpVal(v, x) >= 0;
            case 'in': return (x || []).some(function (y) { return cmpVal(v, y) === 0; });
            case 'not-in': return v !== undefined && !(x || []).some(function (y) { return cmpVal(v, y) === 0; });
            case 'array-contains': return Array.isArray(v) && v.some(function (y) { return cmpVal(y, x) === 0; });
            case 'array-contains-any': return Array.isArray(v) && v.some(function (y) { return (x || []).some(function (z) { return cmpVal(y, z) === 0; }); });
        }
        console.warn('[AREA TEST] operatore where non simulato:', f.op);
        return true;
    }
    Query.prototype._run = function () {
        var self = this, prefix = this._colPath + '/', depth = this._colPath.split('/').length + 1, out = [];
        store.forEach(function (enc, path) {
            if (path.indexOf(prefix) !== 0 || path.split('/').length !== depth) return;
            out.push(new DocumentSnapshot(new DocumentReference(self.firestore, path), enc));
        });
        out = out.filter(function (s) {
            if (!self._filters.every(function (f) { return filterMatch(s, f); })) return false;
            // come Firestore: orderBy esclude i documenti senza quel campo
            return self._orders.every(function (o) { return fieldOf(s, o.field) !== undefined; });
        });
        var orders = this._orders.length ? this._orders : [];
        out.sort(function (a, b) {
            for (var i = 0; i < orders.length; i++) {
                var c = cmpVal(fieldOf(a, orders[i].field), fieldOf(b, orders[i].field));
                if (c) return orders[i].dir === 'desc' ? -c : c;
            }
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
        if (typeof this._limit === 'number') out = out.slice(0, this._limit);
        if (typeof this._limitLast === 'number') out = out.slice(Math.max(0, out.length - this._limitLast));
        return out;
    };
    Query.prototype.get = function () { var self = this; return Promise.resolve().then(function () { var d = self._run(); return new QuerySnapshot(self, d, d.map(function (s, i) { return { type: 'added', doc: s, oldIndex: -1, newIndex: i }; })); }); };
    Query.prototype.onSnapshot = function () {
        var self = this, h = parseListenArgs(arguments), prev = null, active = true;
        var l = {
            check: function () {
                if (!active) return;
                var docs = self._run(), keyNow = docs.map(function (d) { return d.ref.path + '\u0001' + JSON.stringify(d._enc); }).join('\u0002');
                if (prev && prev.key === keyNow) return;
                var changes = [], prevMap = new Map();
                if (prev) prev.docs.forEach(function (d, i) { prevMap.set(d.ref.path, { d: d, i: i }); });
                var nowMap = new Map(); docs.forEach(function (d, i) { nowMap.set(d.ref.path, i); });
                if (prev) prev.docs.forEach(function (d, i) { if (!nowMap.has(d.ref.path)) changes.push({ type: 'removed', doc: d, oldIndex: i, newIndex: -1 }); });
                docs.forEach(function (d, i) {
                    var p = prevMap.get(d.ref.path);
                    if (!p) changes.push({ type: 'added', doc: d, oldIndex: -1, newIndex: i });
                    else if (JSON.stringify(p.d._enc) !== JSON.stringify(d._enc)) changes.push({ type: 'modified', doc: d, oldIndex: p.i, newIndex: i });
                });
                prev = { key: keyNow, docs: docs };
                try { h.next(new QuerySnapshot(self, docs, changes)); } catch (e) { console.error(e); }
            }
        };
        listeners.add(l);
        setTimeout(function () { l.check(); }, 0);
        return function () { active = false; listeners.delete(l); };
    };

    function CollectionReference(db, path) {
        Query.call(this, db, path);
        this.path = path; var segs = path.split('/'); this.id = segs[segs.length - 1];
    }
    CollectionReference.prototype = Object.create(Query.prototype);
    CollectionReference.prototype.constructor = CollectionReference;
    Object.defineProperty(CollectionReference.prototype, 'parent', { get: function () { var s = this.path.split('/'); return s.length > 1 ? new DocumentReference(this.firestore, s.slice(0, -1).join('/')) : null; } });
    CollectionReference.prototype.doc = function (id) {
        if (id === undefined || id === null || id === '') id = autoId();
        return new DocumentReference(this.firestore, this.path + '/' + id);
    };
    CollectionReference.prototype.add = function (data) { var ref = this.doc(); return ref.set(data).then(function () { return ref; }); };

    // ── Batch / transazioni ─────────────────────────────────────────────
    function WriteBatch() { this._ops = []; this._done = false; }
    WriteBatch.prototype.set = function (ref, data, opt) { this._ops.push(function () { writeSet(ref.path, data, opt); }); return this; };
    WriteBatch.prototype.update = function (ref) { var args = Array.prototype.slice.call(arguments, 1); this._ops.push(function () { writeUpdate(ref.path, args); }); return this; };
    WriteBatch.prototype.delete = function (ref) { this._ops.push(function () { writeDelete(ref.path); }); return this; };
    WriteBatch.prototype.commit = function () {
        var ops = this._ops; this._done = true;
        return Promise.resolve().then(function () {
            var backup = new Map(store);
            try { ops.forEach(function (op) { op(); }); }
            catch (e) { // tutto o niente, come Firestore
                Array.from(store.keys()).forEach(function (k) { if (!backup.has(k)) { store.delete(k); persist(k, undefined); } });
                backup.forEach(function (v, k) { store.set(k, v); persist(k, v); });
                throw e;
            }
            notifyAll();
        });
    };

    Firestore.prototype.collection = function (path) { return new CollectionReference(this, String(path).replace(/^\/+|\/+$/g, '')); };
    Firestore.prototype.doc = function (path) { return new DocumentReference(this, String(path).replace(/^\/+|\/+$/g, '')); };
    Firestore.prototype.collectionGroup = function (id) {
        var db = this, q = new Query(db, '\u0000group:' + id);
        q._run = function () {
            var out = [];
            store.forEach(function (enc, path) { var s = path.split('/'); if (s.length % 2 === 0 && s[s.length - 2] === id) out.push(new DocumentSnapshot(new DocumentReference(db, path), enc)); });
            var self = this; out = out.filter(function (s) { return self._filters.every(function (f) { return filterMatch(s, f); }); });
            return out;
        };
        return q;
    };
    Firestore.prototype.batch = function () { return new WriteBatch(); };
    Firestore.prototype.runTransaction = function (fn) {
        var b = new WriteBatch();
        var tx = { get: function (ref) { return ref.get(); }, set: function (r, d, o) { b.set(r, d, o); return tx; }, update: function () { b.update.apply(b, arguments); return tx; }, delete: function (r) { b.delete(r); return tx; } };
        return Promise.resolve(fn(tx)).then(function (res) { return b.commit().then(function () { return res; }); });
    };
    Firestore.prototype.enablePersistence = function () { return Promise.resolve(); };
    Firestore.prototype.clearPersistence = function () { return Promise.resolve(); };
    Firestore.prototype.enableNetwork = function () { return Promise.resolve(); };
    Firestore.prototype.disableNetwork = function () { return Promise.resolve(); };
    Firestore.prototype.waitForPendingWrites = function () { return Promise.resolve(); };
    Firestore.prototype.terminate = function () { return Promise.resolve(); };
    Firestore.prototype.settings = function () {};
    Firestore.prototype.useEmulator = function () {};

    // ── Auth anonima finta ──────────────────────────────────────────────
    function Auth(app) { this.app = app; this.currentUser = null; this._obs = []; }
    function testUid() {
        var k = PREFIX + '__uid', u = null;
        try { u = LS && LS.getItem(k); } catch (e) {}
        if (!u) { u = 'test-' + autoId(); try { LS && LS.setItem(k, u); } catch (e) {} }
        return u;
    }
    Auth.prototype._emit = function () { var u = this.currentUser; this._obs.forEach(function (cb) { try { cb(u); } catch (e) { console.error(e); } }); };
    Auth.prototype.signInAnonymously = function () {
        var self = this;
        return Promise.resolve().then(function () {
            if (!self.currentUser) { self.currentUser = { uid: testUid(), isAnonymous: true, providerData: [], getIdToken: function () { return Promise.resolve('test-token'); } }; self._emit(); }
            return { user: self.currentUser, credential: null, additionalUserInfo: { isNewUser: false, providerId: null } };
        });
    };
    Auth.prototype.onAuthStateChanged = function (cb) { var self = this; this._obs.push(cb); setTimeout(function () { try { cb(self.currentUser); } catch (e) {} }, 0); return function () { self._obs = self._obs.filter(function (x) { return x !== cb; }); }; };
    Auth.prototype.onIdTokenChanged = Auth.prototype.onAuthStateChanged;
    Auth.prototype.signOut = function () { this.currentUser = null; this._emit(); return Promise.resolve(); };
    Auth.prototype.setPersistence = function () { return Promise.resolve(); };
    Auth.prototype.useEmulator = function () {};
    Auth.Persistence = { LOCAL: 'local', SESSION: 'session', NONE: 'none' };

    // ── Namespace "firebase" ────────────────────────────────────────────
    var apps = [], fsInstances = new Map(), authInstances = new Map();
    function App(options, name) { this.options = Object.freeze(Object.assign({}, options || {})); this.name = name || '[DEFAULT]'; }
    App.prototype.firestore = function () { return firestore(this); };
    App.prototype.auth = function () { return auth(this); };
    App.prototype.delete = function () { var self = this; apps = apps.filter(function (a) { return a !== self; }); return Promise.resolve(); };
    function defaultApp() { if (!apps.length) throw err('app/no-app', "No Firebase App '[DEFAULT]' has been created"); return apps[0]; }
    function firestore(app) { app = app || defaultApp(); if (!fsInstances.has(app)) fsInstances.set(app, new Firestore(app)); return fsInstances.get(app); }
    function auth(app) { app = app || defaultApp(); if (!authInstances.has(app)) authInstances.set(app, new Auth(app)); return authInstances.get(app); }
    firestore.FieldValue = FieldValue;
    firestore.FieldPath = FieldPath;
    firestore.Timestamp = Timestamp;
    firestore.Firestore = Firestore;
    firestore.DocumentReference = DocumentReference;
    firestore.CollectionReference = CollectionReference;
    firestore.Query = Query;
    firestore.setLogLevel = function () {};
    auth.Auth = Auth;

    var firebase = {
        __isTestMock: true,
        SDK_VERSION: 'area-test-mock',
        get apps() { return apps.slice(); },
        initializeApp: function (options, name) {
            var a = new App(options, name);
            apps.push(a);
            console.info('%c[AREA TEST] Firebase scollegato: tutti i dati restano solo in questo browser.', 'background:#dc2626;color:#fff;padding:2px 6px;font-weight:bold');
            return a;
        },
        app: function (name) { return name ? apps.find(function (a) { return a.name === name; }) : defaultApp(); },
        firestore: firestore,
        auth: auth
    };
    window.firebase = firebase;

    // strumenti per le prove
    window.__testFirebase = {
        dump: function () { var o = {}; store.forEach(function (v, k) { o[k] = v; }); return o; },
        reset: function () {
            Array.from(store.keys()).forEach(function (k) { persist(k, undefined); });
            store.clear();
            try { if (LS) { var del = []; for (var i = 0; i < LS.length; i++) { var k = LS.key(i); if (k && k.indexOf(PREFIX) === 0) del.push(k); } del.forEach(function (k) { LS.removeItem(k); }); } } catch (e) {}
            notifyAll();
        },
        importJSON: function (obj) {
            Object.keys(obj || {}).forEach(function (k) { store.set(k, obj[k]); persist(k, obj[k]); });
            notifyAll();
        },
        count: function () { return store.size; }
    };
})();
