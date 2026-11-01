/*
 * AREA TEST — comandi Firebase "modulari" (v9/v10: getFirestore, addDoc, onSnapshot…)
 * sopra il Firebase finto di firebase-mock.js. Serve alla copia del portale richieste,
 * che è scritto con quei comandi. Niente parte verso Google: tutto resta nel browser.
 */
(function () {
    'use strict';
    var fb = window.firebase;
    function wrapDoc(s) {
        return { id: s.id, ref: s.ref, data: function () { return s.data(); }, get: function (f) { return s.get(f); }, exists: function () { return !!s.exists; }, metadata: s.metadata || {} };
    }
    function wrapQuery(s) {
        var docs = s.docs.map(wrapDoc);
        return { docs: docs, size: docs.length, empty: !docs.length, forEach: function (cb) { docs.forEach(cb); }, docChanges: function () { return (s.docChanges ? s.docChanges() : []).map(function (c) { return { type: c.type, doc: wrapDoc(c.doc), oldIndex: c.oldIndex, newIndex: c.newIndex }; }); } };
    }
    function isDocRef(r) { return r && typeof r.collection === 'function' && typeof r.set === 'function'; }
    function wrapSnap(r, s) { return isDocRef(r) ? wrapDoc(s) : wrapQuery(s); }
    window.FBMOD = {
        initializeApp: function (cfg) { try { return fb.apps && fb.apps.length ? fb.app() : fb.initializeApp(cfg); } catch (e) { return fb.app(); } },
        getFirestore: function () { return fb.firestore(); },
        collection: function (db) { var segs = Array.prototype.slice.call(arguments, 1); return db.collection(segs.join('/')); },
        doc: function (base) {
            var segs = Array.prototype.slice.call(arguments, 1);
            if (typeof base.add === 'function') return segs.length ? base.doc(segs.join('/')) : base.doc();   // collezione
            return base.doc(segs.join('/'));   // database
        },
        addDoc: function (col, data) { return col.add(data); },
        setDoc: function (ref, data, opts) { return ref.set(data, opts); },
        updateDoc: function (ref) { return ref.update.apply(ref, Array.prototype.slice.call(arguments, 1)); },
        deleteDoc: function (ref) { return ref.delete(); },
        getDoc: function (ref) { return ref.get().then(wrapDoc); },
        getDocs: function (q) { return q.get().then(wrapQuery); },
        onSnapshot: function (r, next, error) { return r.onSnapshot(function (s) { next && next(wrapSnap(r, s)); }, error); },
        query: function (base) { var q = base; Array.prototype.slice.call(arguments, 1).forEach(function (c) { q = c(q); }); return q; },
        where: function (f, op, v) { return function (q) { return q.where(f, op, v); }; },
        orderBy: function (f, dir) { return function (q) { return q.orderBy(f, dir); }; },
        limit: function (n) { return function (q) { return q.limit(n); }; }
    };
})();
