window.RP = window.RP || {};

/* Live re-routing for the driver screen.

   The route already tells us where the jams are — TomTom marks them and the map
   paints them orange/red. So the main trigger is simply geographic: when the
   driver gets within ~2 km of a *serious* jam, ask once for an alternative,
   while there is still time to take a different road. Reacting after the driver
   is already stuck would be too late.

   A crawling-speed trigger is kept as a backup for jams that formed after the
   route was planned and therefore are not in the plan.

   Every scan costs an API call, so a scan needs ALL the hard limits to pass
   (time, distance moved, daily budget, online) plus one of those two reasons. */
RP.reroute = (function(){
  "use strict";

  var CFG = {
    minIntervalMs:    3 * 60 * 1000,  // aynı taramadan en az 3 dk sonra
    minMoveMeters:    700,            // en az 700 m ilerlemeden tekrar tarama
    jamLookaheadKm:   2,              // yoğun trafiğe bu kadar kala tara
    jamMinMagnitude:  3,              // yalnızca kırmızı ve üzeri (yoğun/durma)
    jamHandledKm:     0.35,           // aynı tıkanıklığı tekrar saymamak için
    stuckWindowMs:    5 * 60 * 1000,  // ilerlemeyi bu pencerede ölç
    stuckKmh:         10,             // 5 dk'da bu hızın altı = gerçekten takılmış
    nearStopMeters:   350,            // durağa yaklaşınca yavaşlamak normaldir
    minGainSeconds:   180,            // en az 3 dk kazanç
    minGainRatio:     0.08,           // ve mevcut sürenin en az %8'i
    dismissCooldownMs: 15 * 60 * 1000,// "yoksay" denince 15 dk sus
    dailyBudget:      60              // günde en fazla 60 tarama
  };

  var samples = [];          // { t, lat, lon, speedKmh }
  var lastScanAt = Date.now();
  var lastScanPos = null;
  var dismissedUntil = 0;
  var jams = [];             // planlanan rotadaki tıkanıklıklar
  var handledJams = [];      // aynı tıkanıklık için tekrar tarama yapmamak için

  /* ---------- daily budget ---------- */

  // local date, so the budget resets at local midnight rather than 03:00
  function today(){
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  function quota(){
    try {
      var q = JSON.parse(localStorage.getItem('rp_reroute_quota') || 'null');
      if(q && q.date === today()) return q;
    } catch(e){}
    return { date: today(), used: 0 };
  }

  /* Kept in memory too: when localStorage is unavailable (private mode, blocked
     site data) the stored counter stays 0 for ever and the cap that protects the
     TomTom quota would never engage. */
  var usedThisSession = 0;

  function budgetLeft(){
    return Math.max(0, CFG.dailyBudget - Math.max(quota().used, usedThisSession));
  }

  function spend(){
    usedThisSession++;
    var q = quota();
    q.used = Math.max(q.used + 1, usedThisSession);
    try { localStorage.setItem('rp_reroute_quota', JSON.stringify(q)); } catch(e){}
  }

  /* ---------- movement tracking ---------- */

  function pushPosition(pos){
    var c = pos.coords;
    // a very coarse fix (cell-tower level) would only add noise
    if(c.accuracy != null && c.accuracy > 60) return;
    var now = Date.now();
    var speed = c.speed != null && c.speed >= 0 ? c.speed * 3.6 : null;

    // no speed from the device: derive it from the previous fix
    if(speed == null && samples.length){
      var prev = samples[samples.length - 1];
      var dtSec = (now - prev.t) / 1000;
      if(dtSec > 1){
        var km = RP.geo.haversine({ lat: prev.lat, lon: prev.lon },
                                  { lat: c.latitude, lon: c.longitude });
        speed = (km / dtSec) * 3600;
      }
    }

    samples.push({ t: now, lat: c.latitude, lon: c.longitude, speedKmh: speed });
    // keep a few minutes of history, nothing more
    var cutoff = now - 8 * 60 * 1000;
    while(samples.length && samples[0].t < cutoff) samples.shift();
  }

  /* How much ground was actually covered over the window, as km/h.

     Instantaneous speed is the wrong signal here: it hits zero at every red
     light, and a long light would look exactly like a jam. Distance travelled
     over several minutes does not care about lights — between them the driver
     covers ground — but stays low when genuinely stuck. */
  function progressKmh(windowMs){
    var now = Date.now();
    var win = samples.filter(function(s){ return now - s.t <= windowMs; });
    if(win.length < 4) return null;

    var span = now - win[0].t;
    if(span < windowMs * 0.8) return null;   // window not covered yet

    /* DISPLACEMENT, not path length. Summing consecutive fixes adds up GPS
       jitter: a parked car sampled once a second reads 38-130 km/h of pure
       noise, which made this check unable to ever fire. How far the vehicle
       actually got is immune to that. */
    var far = 0;
    for(var i = 1; i < win.length; i++){
      var d = RP.geo.haversine(
        { lat: win[0].lat, lon: win[0].lon },
        { lat: win[i].lat, lon: win[i].lon }
      );
      if(d > far) far = d;
    }
    return far / (span / 3600000);
  }

  function lastPosition(){
    return samples.length ? samples[samples.length - 1] : null;
  }

  /* ---------- known jams from the planned route ---------- */

  /* `list` comes from the saved route: {lat, lon, magnitude, delay, speed}. */
  function setJams(list){
    jams = (list || []).filter(function(j){
      return j && j.lat != null && j.lon != null &&
             (j.magnitude || 0) >= CFG.jamMinMagnitude;
    });
    handledJams = [];
  }

  function alreadyHandled(jam){
    return handledJams.some(function(h){
      return RP.geo.haversine(h, jam) < CFG.jamHandledKm;
    });
  }

  /* The nearest serious jam the driver is approaching, if any. */
  function jamAhead(pos){
    var best = null;
    jams.forEach(function(j){
      if(alreadyHandled(j)) return;
      var km = RP.geo.haversine({ lat: pos.lat, lon: pos.lon }, j);
      if(km > CFG.jamLookaheadKm) return;
      if(!best || km < best.km) best = { jam: j, km: km };
    });
    return best;
  }

  /* ---------- decide whether a scan is worth an API call ---------- */

  function decide(nextStop){
    var pos = lastPosition();
    if(!pos) return { ok: false, why: 'konum yok' };
    if(!RP.routing.hasKey()) return { ok: false, why: 'TomTom anahtarı yok' };
    if(!navigator.onLine) return { ok: false, why: 'çevrimdışı' };
    if(Date.now() < dismissedUntil) return { ok: false, why: 'kullanıcı yoksaydı' };
    if(budgetLeft() <= 0) return { ok: false, why: 'günlük tarama bütçesi doldu' };

    var since = Date.now() - lastScanAt;
    if(since < CFG.minIntervalMs) return { ok: false, why: 'çok erken' };

    if(lastScanPos){
      var movedKm = RP.geo.haversine(lastScanPos, { lat: pos.lat, lon: pos.lon });
      if(movedKm * 1000 < CFG.minMoveMeters) return { ok: false, why: 'yeterince ilerlemedi' };
    }

    // slowing down right next to the stop is just the delivery itself
    if(nextStop){
      var toStopKm = RP.geo.haversine({ lat: pos.lat, lon: pos.lon }, nextStop);
      if(toStopKm * 1000 < CFG.nearStopMeters) return { ok: false, why: 'durağa çok yakın' };
    }

    // main reason: a known serious jam is coming up
    var ahead = jamAhead(pos);
    if(ahead){
      return {
        ok: true,
        jam: ahead.jam,
        why: Math.round(ahead.km * 10) / 10 + ' km ilerideki yoğun trafik'
      };
    }

    /* Backup: genuinely not getting anywhere, which means a jam the plan did
       not know about. Measured over 5 minutes so red lights do not count. */
    var pace = progressKmh(CFG.stuckWindowMs);
    if(pace != null && pace < CFG.stuckKmh){
      return { ok: true, why: 'son 5 dakikada yalnızca ' + Math.round(pace) + ' km/s ilerleme' };
    }
    return { ok: false, why: 'yaklaşan trafik yok' };
  }

  /* ---------- the scan itself ---------- */

  /* plannedRemainingSec: how long the original plan still expects to take from
     here to the next stop. A fresh route is only offered when it beats that by
     a margin big enough to be worth changing course for. */
  function scan(nextStop, plannedRemainingSec, jam){
    var pos = lastPosition();
    lastScanAt = Date.now();
    lastScanPos = { lat: pos.lat, lon: pos.lon };
    if(jam) handledJams.push({ lat: jam.lat, lon: jam.lon });
    spend();

    return RP.routing.computeRoute(
      [{ lat: pos.lat, lon: pos.lon }, { lat: nextStop.lat, lon: nextStop.lon }],
      null, 'duration'
    ).then(function(route){
      if(!route || !route.traffic) return null;     // OSRM fallback carries no traffic

      var gain = plannedRemainingSec - route.duration;
      var ratio = plannedRemainingSec > 0 ? gain / plannedRemainingSec : 0;
      var jamDelay = (route.trafficSections || []).reduce(function(a, s){
        return a + (s.delay || 0);
      }, 0);

      if(gain < CFG.minGainSeconds || ratio < CFG.minGainRatio){
        return { better: false, newDuration: route.duration, jamDelay: jamDelay };
      }
      return {
        better: true,
        gainSeconds: gain,
        newDuration: route.duration,
        newDistance: route.distance,
        jamDelay: jamDelay,
        route: route
      };
    }).catch(function(err){
      console.warn('Alternatif rota taranamadı:', err.message);
      return null;
    });
  }

  function dismiss(){ dismissedUntil = Date.now() + CFG.dismissCooldownMs; }

  function stats(){
    return {
      scansToday: quota().used,
      budgetLeft: budgetLeft(),
      lastScanAt: lastScanAt,
      progressKmh: progressKmh(CFG.stuckWindowMs),
      knownJams: jams.length,
      handledJams: handledJams.length
    };
  }

  /* Called when location sharing starts. The periodic timer counts from now, so
     switching sharing on does not immediately spend an API call. */
  function reset(){
    samples = [];
    lastScanAt = Date.now();
    lastScanPos = null;
    dismissedUntil = 0;
    handledJams = [];
  }

  return {
    CFG: CFG,
    pushPosition: pushPosition,
    setJams: setJams,
    decide: decide,
    scan: scan,
    dismiss: dismiss,
    stats: stats,
    reset: reset
  };
})();
