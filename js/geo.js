window.RP = window.RP || {};

RP.geo = (function(){
  "use strict";

  var cache = {};
  var lastCall = 0;

  // Nominatim asks for max 1 req/sec — queue calls so bulk imports stay polite.
  function throttled(fn){
    var wait = Math.max(0, 1100 - (Date.now() - lastCall));
    lastCall = Date.now() + wait;
    return new Promise(function(res){ setTimeout(function(){ res(fn()); }, wait); });
  }

  function parseLatLon(q){
    var m = String(q||'').trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if(!m) return null;
    var lat = parseFloat(m[1]), lon = parseFloat(m[2]);
    if(Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat: lat, lon: lon, label: lat.toFixed(5) + ', ' + lon.toFixed(5) };
  }

  function search(q, limit){
    if(!q || q.trim().length < 3) return Promise.resolve([]);
    var key = q.trim().toLowerCase();
    if(cache[key]) return Promise.resolve(cache[key]);
    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=0&limit='
      + (limit||6) + '&q=' + encodeURIComponent(q);
    return fetch(url, {headers:{'Accept-Language':'tr'}})
      .then(function(r){ return r.ok ? r.json() : []; })
      .then(function(data){
        var list = (data||[]).map(function(d){
          return { label: d.display_name, lat: parseFloat(d.lat), lon: parseFloat(d.lon) };
        });
        cache[key] = list;
        return list;
      })
      .catch(function(){ return []; });
  }

  function geocodeOne(q){
    var direct = parseLatLon(q);
    if(direct) return Promise.resolve(direct);
    return throttled(function(){ return search(q, 1); }).then(function(list){
      return list.length ? list[0] : null;
    });
  }

  function geocodeMany(texts, onProgress){
    var out = [];
    return texts.reduce(function(chain, t, i){
      return chain.then(function(){
        return geocodeOne(t).then(function(hit){
          out.push({ query: t, hit: hit });
          if(onProgress) onProgress(i+1, texts.length);
        });
      });
    }, Promise.resolve()).then(function(){ return out; });
  }

  function reverse(lat, lon){
    var url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + lat + '&lon=' + lon;
    return fetch(url, {headers:{'Accept-Language':'tr'}})
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){ return d && d.display_name ? d.display_name : null; })
      .catch(function(){ return null; });
  }

  /* "Bursa, Türkiye" rather than the full postal address — used when telling the
     user which place the map just jumped to. */
  function reverseShort(lat, lon){
    var url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=10&lat='
      + lat + '&lon=' + lon;
    return fetch(url, {headers:{'Accept-Language':'tr'}})
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){
        if(!d) return null;
        var a = d.address || {};
        // In Turkey the il (city) lands in `province` while `town` is the district
        // (Ankara vs. Altındağ); elsewhere `city` is usually the right field.
        var city = a.city || a.province || a.state || a.town || a.county || a.village || '';
        var country = a.country || '';
        var label = [city, country].filter(Boolean).join(', ');
        return { city: city, country: country, label: label || d.display_name || '' };
      })
      .catch(function(){ return null; });
  }

  function haversine(a, b){
    var R = 6371, dLat = (b.lat-a.lat)*Math.PI/180, dLon = (b.lon-a.lon)*Math.PI/180;
    var s1 = Math.sin(dLat/2), s2 = Math.sin(dLon/2);
    var v = s1*s1 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*s2*s2;
    return 2*R*Math.asin(Math.sqrt(v));
  }

  return {
    parseLatLon: parseLatLon,
    search: search,
    geocodeOne: geocodeOne,
    geocodeMany: geocodeMany,
    reverse: reverse,
    reverseShort: reverseShort,
    haversine: haversine
  };
})();
