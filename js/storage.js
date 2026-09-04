window.RP = window.RP || {};

/* Firestore-backed persistence: route history, share links and live driver
   location. The Firebase config is pasted by the user and kept in localStorage,
   so nothing secret is committed to the repo. Every call rejects cleanly when
   Firebase is not configured — the planner itself keeps working offline. */
RP.storage = (function(){
  "use strict";

  var app = null, db = null, ready = null;

  function rawConfig(){ return localStorage.getItem('firebase_config') || ''; }

  /* The site owner's project (js/firebase-config.js) is the normal source, so
     visitors just sign up. A config pasted in Settings overrides it, which lets
     someone self-host the app against their own Firebase project. */
  function builtInConfig(){
    var c = window.RP && RP.firebaseConfig;
    return (c && c.apiKey && c.projectId) ? c : null;
  }

  function getConfig(){
    try {
      var c = JSON.parse(rawConfig());
      if(c && c.projectId && c.apiKey) return c;
    } catch(e){}
    return builtInConfig();
  }

  function isConfigured(){ return !!getConfig(); }

  function saveConfig(text){
    var trimmed = String(text||'').trim();
    if(!trimmed){ localStorage.removeItem('firebase_config'); app = null; db = null; ready = null; return true; }
    // accept both a bare JSON object and a pasted "const firebaseConfig = {...};" snippet
    var m = trimmed.match(/\{[\s\S]*\}/);
    if(!m) return false;
    var jsonish = m[0]
      .replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":')
      .replace(/'/g, '"')
      .replace(/,(\s*[}\]])/g, '$1');
    try {
      var parsed = JSON.parse(jsonish);
      if(!parsed.apiKey || !parsed.projectId) return false;
      localStorage.setItem('firebase_config', JSON.stringify(parsed));
      app = null; db = null; ready = null;
      return true;
    } catch(e){ return false; }
  }

  /* Share links carry the project config in their hash so recipients don't have
     to set anything up. A Firebase web config is not a secret — it identifies
     the project, and access is governed by Firestore security rules. */
  function encodeConfigForLink(){
    var cfg = getConfig();
    if(!cfg) return '';
    return '#cfg=' + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(cfg)))));
  }

  /* Share links carry the project config so a recipient of a self-hosted copy
     needs no setup. That is also an attack surface: a crafted link could point
     the victim's browser at someone else's Firebase project, where their next
     sign-in and every route they save would land.

     So a link config is only adopted when this deployment has none of its own,
     and when it names the SAME project it is a no-op. A link pointing somewhere
     else is refused outright. */
  function adoptConfigFromHash(){
    var m = (location.hash || '').match(/cfg=([^&]+)/);
    if(!m) return false;
    try {
      var json = decodeURIComponent(escape(atob(decodeURIComponent(m[1]))));
      var parsed = JSON.parse(json);
      if(!parsed.apiKey || !parsed.projectId) return false;

      var current = getConfig();
      if(current){
        if(current.projectId === parsed.projectId) return false;   // already there
        console.warn('Linkteki Firebase projesi (' + parsed.projectId +
          ') bu sitenin projesinden (' + current.projectId + ') farklı — yok sayıldı.');
        return false;
      }

      localStorage.setItem('firebase_config', JSON.stringify(parsed));
      app = null; db = null; ready = null;
      return true;
    } catch(e){ return false; }
  }

  function init(){
    if(ready) return ready;
    var cfg = getConfig();
    if(!cfg) return Promise.reject(new Error('Firebase yapılandırılmamış'));
    if(typeof firebase === 'undefined') return Promise.reject(new Error('Firebase SDK yüklenemedi'));

    ready = new Promise(function(resolve, reject){
      try {
        app = firebase.apps && firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
        db = firebase.firestore();
        var auth = firebase.auth();
        /* A persisted session is restored asynchronously, so currentUser is null
           for a moment after load. Signing in anonymously right away would
           replace the real account; wait for the first auth state instead. */
        var settled = false;
        var unsub = auth.onAuthStateChanged(function(user){
          if(settled) return;
          settled = true;
          unsub();
          if(user) return resolve(db);
          auth.signInAnonymously()
            .then(function(){ resolve(db); })
            .catch(function(err){
              // anonymous auth may be disabled; signed-in features simply stay off
              console.warn('Anonim giriş yapılamadı:', err.message);
              resolve(db);
            });
        }, function(err){
          if(settled) return;
          settled = true;
          reject(err);
        });
      } catch(err){ reject(err); }
    });
    return ready;
  }

  function uid(){
    try { return (firebase.auth().currentUser || {}).uid || 'anon'; } catch(e){ return 'anon'; }
  }

  function saveRoute(data){
    return init().then(function(db){
      var doc = Object.assign({}, data, {
        owner: uid(),
        createdAt: Date.now()
      });
      return db.collection('routes').add(doc).then(function(ref){ return ref.id; });
    });
  }

  function loadRoute(id){
    return init().then(function(db){
      return db.collection('routes').doc(id).get().then(function(snap){
        if(!snap.exists) throw new Error('Rota bulunamadı');
        return Object.assign({ id: snap.id }, snap.data());
      });
    });
  }


  /* Firestore needs a composite index for where()+orderBy() on different fields.
     Until that index exists the query fails with 'failed-precondition', so the
     call falls back to an unordered read and sorts locally. That keeps the app
     working the moment it is deployed; creating the index (see
     firestore.indexes.json) restores correct paging for large histories. */
  function queryNewest(build, limitTo){
    return build(true).get()
      .catch(function(err){
        if(err && err.code !== 'failed-precondition') throw err;
        console.warn('Firestore indeksi yok, istemci tarafinda siralaniyor. ' +
                     'Kalici cozum icin indeksi olusturun: ' + (err.message || ''));
        return build(false).get();
      })
      .then(function(qs){
        var out = [];
        qs.forEach(function(d){ out.push(Object.assign({ id: d.id }, d.data())); });
        out.sort(function(a, b){ return (b.createdAt || 0) - (a.createdAt || 0); });
        return out.slice(0, limitTo);
      });
  }

  function listHistory(limit){
    var want = limit || 15;
    return init().then(function(db){
      return queryNewest(function(ordered){
        var q = db.collection('routes').where('owner', '==', uid());
        if(ordered) q = q.orderBy('createdAt', 'desc');
        // unordered fallback pulls a wider slice so the local sort still finds the newest
        return q.limit(ordered ? want : Math.max(want * 4, 60));
      }, want);
    });
  }

  function deleteRoute(id){
    return init().then(function(db){ return db.collection('routes').doc(id).delete(); });
  }

  function updateDriverLocation(id, lat, lon){
    return init().then(function(db){
      return db.collection('routes').doc(id).update({
        driverLocation: { lat: lat, lon: lon, updatedAt: Date.now() }
      });
    });
  }

  function subscribeDriverLocation(id, cb){
    var stop = function(){};
    init().then(function(db){
      stop = db.collection('routes').doc(id).onSnapshot(function(snap){
        var d = snap.data();
        if(d && d.driverLocation) cb(d.driverLocation);
      }, function(err){ console.error(err); });
    }).catch(function(err){ console.error(err); });
    return function(){ stop(); };
  }


  /* ---------- driver assignment ---------- */

  /* Routes are matched to drivers by e-mail so a planner can assign work before
     the driver has ever signed in. */
  function assignDriver(routeId, email){
    return init().then(function(db){
      return db.collection('routes').doc(routeId).update({
        driverEmail: String(email || '').trim().toLowerCase(),
        assignedAt: Date.now()
      });
    });
  }

  function listDriverRoutes(email, limit){
    var want = limit || 20;
    var mail = String(email || '').trim().toLowerCase();
    return init().then(function(db){
      return queryNewest(function(ordered){
        var q = db.collection('routes').where('driverEmail', '==', mail);
        if(ordered) q = q.orderBy('createdAt', 'desc');
        return q.limit(ordered ? want : Math.max(want * 4, 60));
      }, want);
    });
  }

  /* ---------- delivery status ---------- */

  /* One document per stop keeps each proof photo well under Firestore's 1 MB
     per-document limit, and lets the planner watch progress arrive live. */
  function setDelivery(routeId, stopId, data){
    return init().then(function(db){
      return db.collection('routes').doc(routeId)
        .collection('deliveries').doc(String(stopId))
        .set(Object.assign({}, data, { at: Date.now(), by: uid() }), { merge: true });
    });
  }

  function clearDelivery(routeId, stopId){
    return init().then(function(db){
      return db.collection('routes').doc(routeId)
        .collection('deliveries').doc(String(stopId)).delete();
    });
  }

  function listDeliveries(routeId){
    return init().then(function(db){
      return db.collection('routes').doc(routeId).collection('deliveries').get()
        .then(function(qs){
          var map = {};
          qs.forEach(function(d){ map[d.id] = d.data(); });
          return map;
        });
    });
  }

  function subscribeDeliveries(routeId, cb){
    var stop = function(){};
    init().then(function(db){
      stop = db.collection('routes').doc(routeId).collection('deliveries')
        .onSnapshot(function(qs){
          var map = {};
          qs.forEach(function(d){ map[d.id] = d.data(); });
          cb(map);
        }, function(err){ console.error(err); });
    }).catch(function(err){ console.error(err); });
    return function(){ stop(); };
  }

  /* ---------- address book ---------- */

  function listAddressBook(){
    if(!isConfigured()) return Promise.resolve(localBook());
    return init().then(function(db){
      return db.collection('users').doc(uid()).collection('places')
        .orderBy('label').limit(200).get()
        .then(function(qs){
          var out = [];
          qs.forEach(function(d){ out.push(Object.assign({ id: d.id }, d.data())); });
          return out;
        });
    }).catch(function(){ return localBook(); });
  }

  function saveAddress(place){
    var entry = { label: place.label, lat: place.lat, lon: place.lon, savedAt: Date.now() };
    if(!isConfigured()){
      var book = localBook();
      book.push(Object.assign({ id: 'l' + Date.now() }, entry));
      localStorage.setItem('rp_places', JSON.stringify(book.slice(-200)));
      return Promise.resolve(entry);
    }
    return init().then(function(db){
      return db.collection('users').doc(uid()).collection('places').add(entry);
    });
  }

  function deleteAddress(id){
    if(!isConfigured() || String(id).charAt(0) === 'l'){
      var book = localBook().filter(function(p){ return p.id !== id; });
      localStorage.setItem('rp_places', JSON.stringify(book));
      return Promise.resolve();
    }
    return init().then(function(db){
      return db.collection('users').doc(uid()).collection('places').doc(id).delete();
    });
  }

  function localBook(){
    try { return JSON.parse(localStorage.getItem('rp_places') || '[]'); }
    catch(e){ return []; }
  }

  return {
    isConfigured: isConfigured,
    usesBuiltInConfig: function(){ return !localStorage.getItem('firebase_config') && !!builtInConfig(); },
    rawConfig: rawConfig,
    saveConfig: saveConfig,
    encodeConfigForLink: encodeConfigForLink,
    adoptConfigFromHash: adoptConfigFromHash,
    init: init,
    saveRoute: saveRoute,
    loadRoute: loadRoute,
    listHistory: listHistory,
    deleteRoute: deleteRoute,
    updateDriverLocation: updateDriverLocation,
    subscribeDriverLocation: subscribeDriverLocation,
    assignDriver: assignDriver,
    listDriverRoutes: listDriverRoutes,
    setDelivery: setDelivery,
    clearDelivery: clearDelivery,
    listDeliveries: listDeliveries,
    subscribeDeliveries: subscribeDeliveries,
    listAddressBook: listAddressBook,
    saveAddress: saveAddress,
    deleteAddress: deleteAddress
  };
})();
