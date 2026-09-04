window.RP = window.RP || {};

RP.routing = (function(){
  "use strict";

  function getKey(){ return (localStorage.getItem('tomtom_api_key') || '').trim(); }
  function hasKey(){ return !!getKey(); }

  function osrmRoute(pts){
    var coordStr = pts.map(function(p){ return p.lon+','+p.lat; }).join(';');
    var url = 'https://router.project-osrm.org/route/v1/driving/' + coordStr
      + '?overview=full&geometries=geojson&steps=false&annotations=duration,distance';
    return fetch(url).then(function(r){ return r.json(); }).then(function(data){
      if(data.code !== 'Ok' || !data.routes || !data.routes.length) throw new Error('OSRM: ' + (data.code||'hata'));
      var rt = data.routes[0];
      return {
        distance: rt.distance,
        duration: rt.duration,
        legDurations: (rt.legs||[]).map(function(l){ return l.duration; }),
        legDistances: (rt.legs||[]).map(function(l){ return l.distance; }),
        coordinates: rt.geometry.coordinates,
        traffic: false
      };
    });
  }

  /* "Süre" asks for the fastest road, "Mesafe" for the shortest one. Traffic is
     always on: it changes both the chosen roads and the reported travel time. */
  function routeTypeFor(metric){ return metric === 'distance' ? 'shortest' : 'fastest'; }

  function tomtomRoute(pts, metric){
    var locStr = pts.map(function(p){ return p.lat+','+p.lon; }).join(':');
    var url = 'https://api.tomtom.com/routing/1/calculateRoute/' + locStr + '/json'
      + '?key=' + encodeURIComponent(getKey())
      + '&routeType=' + routeTypeFor(metric)
      + '&traffic=true&travelMode=car&sectionType=traffic';
    return fetch(url).then(function(r){
      if(!r.ok) throw new Error('TomTom: HTTP ' + r.status);
      return r.json();
    }).then(function(data){
      if(!data.routes || !data.routes.length) throw new Error('TomTom: rota bulunamadı');
      var rt = data.routes[0];
      var coords = [];
      rt.legs.forEach(function(leg){
        leg.points.forEach(function(p){ coords.push([p.longitude, p.latitude]); });
      });
      /* Congested stretches, so the map can show where the delay actually is.
         Section indices address the concatenated point list built above; they are
         clamped because a waypoint point can be repeated between legs. */
      var sections = (rt.sections || []).filter(function(sec){
        return sec.sectionType === 'TRAFFIC';
      }).filter(function(sec){
        // a missing index used to become 0, painting a fake jam from the depot
        return sec.startPointIndex != null && sec.endPointIndex != null;
      }).map(function(sec){
        return {
          start: Math.max(0, Math.min(coords.length - 1, sec.startPointIndex)),
          end:   Math.max(0, Math.min(coords.length - 1, sec.endPointIndex)),
          delay: sec.delayInSeconds || 0,
          magnitude: sec.magnitudeOfDelay || 0,
          speed: sec.effectiveSpeedInKmh || null,
          category: sec.simpleCategory || ''
        };
      }).filter(function(sec){ return sec.end > sec.start; });

      return {
        distance: rt.summary.lengthInMeters,
        duration: rt.summary.travelTimeInSeconds,
        trafficDelay: rt.summary.trafficDelayInSeconds || 0,
        legDurations: rt.legs.map(function(l){ return l.summary.travelTimeInSeconds; }),
        legDistances: rt.legs.map(function(l){ return l.summary.lengthInMeters; }),
        coordinates: coords,
        trafficSections: sections,
        traffic: true
      };
    });
  }

  function computeRoute(pts, onFallback, metric){
    if(hasKey()){
      return tomtomRoute(pts, metric).catch(function(err){
        console.error(err);
        if(onFallback) onFallback(err);
        return osrmRoute(pts);
      });
    }
    return osrmRoute(pts);
  }

  var AVG_SPEED_KMH = 35;

  /* Straight-line stand-in used whenever the Matrix API is unavailable:
     distances in km, durations estimated in minutes at city speed. */
  function fallbackMatrix(pts){
    var dist = RP.optimize.haversineMatrix(pts);
    var dur = dist.map(function(row){
      return row.map(function(km){ return (km / AVG_SPEED_KMH) * 60; });
    });
    return { dist: dist, dur: dur, real: false };
  }

  /* Real road distance + duration matrix (TomTom Matrix Routing v2). Falls back
     to straight-line so ordering still works without a key or when quota is hit. */
  function roadMatrix(pts, metric){
    if(!hasKey() || pts.length < 2 || pts.length > 25){
      return Promise.resolve(fallbackMatrix(pts));
    }
    var body = {
      origins: pts.map(function(p){ return { point: { latitude: p.lat, longitude: p.lon } }; }),
      destinations: pts.map(function(p){ return { point: { latitude: p.lat, longitude: p.lon } }; })
    };
    var url = 'https://api.tomtom.com/routing/matrix/2?key=' + encodeURIComponent(getKey())
      + '&routeType=' + routeTypeFor(metric) + '&traffic=true&travelMode=car';
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function(r){
      if(!r.ok) throw new Error('Matrix: HTTP ' + r.status);
      return r.json();
    }).then(function(data){
      var rows = data.data || [];
      if(!rows.length) throw new Error('Matrix: boş yanıt');
      var n = pts.length;
      var dist = [], dur = [];
      for(var i=0;i<n;i++){ dist.push(new Array(n).fill(0)); dur.push(new Array(n).fill(0)); }
      rows.forEach(function(cell){
        var i = cell.originIndex, j = cell.destinationIndex;
        var sum = cell.routeSummary || {};
        if(i == null || j == null) return;
        if(sum.lengthInMeters != null) dist[i][j] = sum.lengthInMeters/1000;
        if(sum.travelTimeInSeconds != null) dur[i][j] = sum.travelTimeInSeconds/60;
      });
      // any pair the API skipped falls back to straight-line so the matrix stays usable
      for(var a=0;a<n;a++){
        for(var b=0;b<n;b++){
          if(a === b) continue;
          if(!dist[a][b]) dist[a][b] = RP.geo.haversine(pts[a], pts[b]);
          if(!dur[a][b]) dur[a][b] = (dist[a][b] / AVG_SPEED_KMH) * 60;
        }
      }
      return { dist: dist, dur: dur, real: true };
    }).catch(function(err){
      console.warn('Matrix API kullanılamadı, kuş uçuşu mesafeye düşülüyor:', err.message);
      return fallbackMatrix(pts);
    });
  }

  return {
    hasKey: hasKey,
    osrmRoute: osrmRoute,
    tomtomRoute: tomtomRoute,
    computeRoute: computeRoute,
    roadMatrix: roadMatrix
  };
})();
