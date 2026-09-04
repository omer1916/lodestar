/* App-shell caching only. Routing, geocoding and Firebase calls always go to the
   network — offline the UI opens but new routes cannot be calculated. */
var CACHE = 'lodestar-v17';
var SHELL = [
  'index.html',
  'app.html',
  'view.html',
  'driver.html',
  'stats.html',
  'kurulum.html',
  'css/style.css',
  'js/icons.js',
  'js/mode.js',
  'js/geo.js',
  'js/optimize.js',
  'js/routing.js',
  'js/firebase-config.js',
  'js/storage.js',
  'js/auth.js',
  'js/auth-ui.js',
  'js/delivery.js',
  'js/scanner.js',
  'js/reroute.js',
  'js/importers.js',
  'js/ocr.js',
  'js/pdf.js',
  'js/app.js',
  'manifest.json',
  'favicon.svg'
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(c){ return c.addAll(SHELL); }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE; })
        .map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  var url = new URL(e.request.url);
  if(e.request.method !== 'GET' || url.origin !== location.origin) return;

  // network-first: an update is never served stale, cache is the offline fallback
  e.respondWith(
    fetch(e.request).then(function(res){
      if(res && res.status === 200){
        var copy = res.clone();
        caches.open(CACHE).then(function(c){ c.put(e.request, copy); });
      }
      return res;
    }).catch(function(){
      return caches.match(e.request);
    })
  );
});
