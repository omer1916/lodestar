(function(){
"use strict";

var VEHICLE_COLORS = ['#3b82f6','#f59e0b','#a855f7','#14b8a6','#ec4899','#84cc16'];
// keeps a degenerate route (identical stops) from snapping to max street zoom
var MAX_FIT_ZOOM = 16;

var start = null;
var end = null;
var stops = [];
var stopSeq = 0;
var lastResult = null;
var liveUnsub = null;
var liveMarker = null;

var map, layerRoute, layerMarkers, layerLive;
var markers = {};

/* ---------- theme ---------- */
var themeBtn = document.getElementById('themeBtn');
function applyTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  themeBtn.innerHTML = RP.icons.svg(t === 'light' ? 'sun' : 'moon');
  localStorage.setItem('rp_theme', t);
}
applyTheme(localStorage.getItem('rp_theme') || 'dark');
themeBtn.addEventListener('click', function(){
  applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
});

/* ---------- toast ---------- */
var toastEl = document.getElementById('toast');
var toastT;
function toast(msg, isErr){
  toastEl.textContent = msg;
  toastEl.className = 'on' + (isErr ? ' err' : '');
  clearTimeout(toastT);
  toastT = setTimeout(function(){ toastEl.className=''; }, 3600);
}

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function fmtKm(m){ return (m/1000).toFixed(1).replace('.', ',') + ' km'; }
function fmtDur(s){
  var h = Math.floor(s/3600), m = Math.round((s%3600)/60);
  return h > 0 ? (h + ' sa ' + m + ' dk') : (m + ' dk');
}
function clockToMin(v){
  var m = String(v||'').match(/^(\d{1,2}):(\d{2})$/);
  return m ? (parseInt(m[1],10)*60 + parseInt(m[2],10)) : null;
}
var fmtClock = RP.pdf.fmtClock;
var windowText = RP.pdf.windowText;

/* ---------- map ---------- */
/* Opening on a world view is useless for a delivery run, so the map starts on
   the last place this browser used and then asks for the real location. */
var FALLBACK_VIEW = { center: [39.0, 35.2], zoom: 6 };
var CITY_ZOOM = 13;

function savedView(){
  try {
    var v = JSON.parse(localStorage.getItem('rp_last_view') || 'null');
    if(v && isFinite(v.lat) && isFinite(v.lon)) return v;
  } catch(e){}
  return null;
}

var initial = savedView();
map = L.map('map', {zoomControl:true}).setView(
  initial ? [initial.lat, initial.lon] : FALLBACK_VIEW.center,
  initial ? (initial.zoom || CITY_ZOOM) : FALLBACK_VIEW.zoom
);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);
layerRoute = L.layerGroup().addTo(map);
layerMarkers = L.layerGroup().addTo(map);
layerLive = L.layerGroup().addTo(map);

/* Once the user drags or zooms, a late-arriving location fix must not yank the
   view out from under them. */
var mapClaimed = false;
map.on('dragstart zoomstart', function(){ mapClaimed = true; });

map.on('moveend', function(){
  var c = map.getCenter();
  try {
    localStorage.setItem('rp_last_view', JSON.stringify({ lat: c.lat, lon: c.lng, zoom: map.getZoom() }));
  } catch(e){}
});

function locateOnStart(){
  if(!navigator.geolocation) return;
  // geolocation needs a secure context; on plain http:// it silently never resolves
  if(!window.isSecureContext && location.hostname !== 'localhost'){
    document.getElementById('hint').innerHTML =
      'Konumun otomatik bulunabilmesi için sitenin <b>https</b> üzerinden açılması gerekiyor. ' +
      'Şimdilik adresi yazarak ya da harita seçiciyle başlayabilirsin.';
    return;
  }

  navigator.geolocation.getCurrentPosition(function(pos){
    if(mapClaimed || start) return;
    var lat = pos.coords.latitude, lon = pos.coords.longitude;
    map.setView([lat, lon], CITY_ZOOM);
    try {
      localStorage.setItem('rp_last_view', JSON.stringify({ lat: lat, lon: lon, zoom: CITY_ZOOM }));
    } catch(e){}
    RP.geo.reverseShort(lat, lon).then(function(place){
      toast(place && place.label
        ? place.label + ' haritada açıldı — başlangıç için konum butonunu kullanabilirsin'
        : 'Konumun haritada açıldı');
    });
  }, function(){
    // denied or unavailable: stay on the remembered/fallback view, no nagging
  }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 });
}
locateOnStart();

function pinIcon(cls, label, color){
  var style = color ? ' style="background:'+color+'"' : '';
  return L.divIcon({
    className: '',
    html: '<div class="pinmk '+cls+'"'+style+'><span>'+label+'</span></div>',
    iconSize: [28,28], iconAnchor: [14,28], popupAnchor:[0,-26]
  });
}

function placeMarker(id, lat, lon, cls, label){
  removeMarker(id);
  var mk = L.marker([lat, lon], { icon: pinIcon(cls, label), draggable: true });
  mk.addTo(layerMarkers);
  mk.on('dragend', function(){
    var ll = mk.getLatLng();
    onMarkerMoved(id, ll.lat, ll.lng);
  });
  markers[id] = mk;
  fitAll();
}
function removeMarker(id){
  if(markers[id]){ layerMarkers.removeLayer(markers[id]); delete markers[id]; }
}
function onMarkerMoved(id, lat, lon){
  if(id === 'start'){
    start = { lat: lat, lon: lon, label: start ? start.label : '' };
    RP.geo.reverse(lat,lon).then(function(l){
      if(l){ start.label = l; document.getElementById('startInp').value = l; }
    });
  } else if(id === 'end'){
    end = { lat: lat, lon: lon, label: end ? end.label : '' };
    RP.geo.reverse(lat,lon).then(function(l){
      if(l){ end.label = l; document.getElementById('endInp').value = l; }
    });
  } else {
    var s = stops.find(function(x){ return x.id === id; });
    if(s){
      s.lat = lat; s.lon = lon;
      RP.geo.reverse(lat,lon).then(function(l){
        if(l){
          s.label = l;
          var row = document.querySelector('.stopwrap[data-id="'+id+'"] input.addr');
          if(row) row.value = l;
        }
      });
    }
  }
}
/* Coalesced so a bulk import re-frames the map once instead of once per stop. */
var fitTimer = null;
function fitAll(){
  clearTimeout(fitTimer);
  fitTimer = setTimeout(function(){
    var pts = [];
    Object.keys(markers).forEach(function(k){ pts.push(markers[k].getLatLng()); });
    if(pts.length === 1) map.setView(pts[0], 13);
    else if(pts.length > 1) map.fitBounds(L.latLngBounds(pts), {padding:[40,40], maxZoom: MAX_FIT_ZOOM});
  }, 60);
}

/* ---------- pick on map ---------- */
var pickingFor = null, pickingCb = null;
function startPicking(id, cb){
  pickingFor = id; pickingCb = cb;
  document.getElementById('map').style.cursor = 'crosshair';
  document.querySelectorAll('.ico[data-pick]').forEach(function(b){ b.classList.remove('act'); });
  var trigger = document.querySelector('[data-pick="'+id+'"]');
  if(trigger) trigger.classList.add('act');
  toast('Haritada bir nokta seçmek için tıkla');
}
map.on('click', function(e){
  if(!pickingFor) return;
  var cb = pickingCb;
  pickingFor = null; pickingCb = null;
  document.getElementById('map').style.cursor = '';
  document.querySelectorAll('.ico[data-pick]').forEach(function(b){ b.classList.remove('act'); });
  cb(e.latlng);
});

/* ---------- autocomplete ---------- */
/* One document-level listener closes every open dropdown. Registering one per
   input would leak a handler for each stop row that is ever created. */
var autocompletes = [];
document.addEventListener('click', function(e){
  for(var i=0;i<autocompletes.length;i++){
    var ac = autocompletes[i];
    if(e.target !== ac.input && !ac.sug.contains(e.target)) ac.close();
  }
});

function wireAutocomplete(inputEl, sugEl, onPick){
  var debounceT, activeIdx = -1, currentItems = [];

  function render(items){
    currentItems = items; activeIdx = -1;
    if(!items.length){ sugEl.classList.remove('on'); sugEl.innerHTML=''; return; }
    sugEl.innerHTML = items.map(function(it, i){
      var parts = it.label.split(',');
      var rest = parts.slice(1).join(',').trim();
      return '<div data-i="'+i+'"><b>'+esc(parts[0])+'</b>' + (rest ? '<small>'+esc(rest)+'</small>' : '') + '</div>';
    }).join('');
    sugEl.classList.add('on');
  }

  inputEl.addEventListener('input', function(){
    var q = inputEl.value;
    inputEl.classList.remove('ok');
    clearTimeout(debounceT);
    var direct = RP.geo.parseLatLon(q);
    if(direct){ render([direct]); return; }
    if(q.trim().length < 3){ render([]); return; }
    debounceT = setTimeout(function(){ RP.geo.search(q).then(render); }, 380);
  });

  inputEl.addEventListener('keydown', function(e){
    if(!sugEl.classList.contains('on')) return;
    if(e.key === 'ArrowDown'){ e.preventDefault(); activeIdx = Math.min(activeIdx+1, currentItems.length-1); highlight(); }
    else if(e.key === 'ArrowUp'){ e.preventDefault(); activeIdx = Math.max(activeIdx-1, 0); highlight(); }
    else if(e.key === 'Enter'){
      e.preventDefault();
      if(activeIdx >= 0 && currentItems[activeIdx]) pick(currentItems[activeIdx]);
      else if(currentItems.length) pick(currentItems[0]);
    } else if(e.key === 'Escape'){ render([]); }
  });

  function highlight(){
    sugEl.querySelectorAll('div').forEach(function(k,i){ k.classList.toggle('hl', i===activeIdx); });
  }

  sugEl.addEventListener('mousedown', function(e){
    var d = e.target.closest('div[data-i]');
    if(!d) return;
    e.preventDefault();
    pick(currentItems[parseInt(d.dataset.i,10)]);
  });

  var entry = { input: inputEl, sug: sugEl, close: function(){ render([]); } };
  autocompletes.push(entry);

  function pick(item){
    inputEl.value = item.label;
    inputEl.classList.add('ok');
    render([]);
    onPick(item);
  }

  return function destroy(){
    clearTimeout(debounceT);
    var i = autocompletes.indexOf(entry);
    if(i >= 0) autocompletes.splice(i, 1);
  };
}

/* ---------- stops ---------- */
var stopsEl = document.getElementById('stops');
var stopCountPill = document.getElementById('stopCount');

function updateStopCount(){
  var valid = stops.filter(function(s){ return s.lat != null; }).length;
  stopCountPill.textContent = valid + '/' + stops.length;
  stopCountPill.className = 'pill ' + (valid ? 'on' : 'off');
}

function addStopRow(prefill){
  var id = 's' + (++stopSeq);
  var data = { id: id, lat: null, lon: null, label: '', load: 0, phone: '', windowStart: null, windowEnd: null };
  stops.push(data);

  var wrap = document.createElement('div');
  wrap.className = 'stopwrap';
  wrap.dataset.id = id;
  wrap.innerHTML =
    '<div class="row">' +
      '<div class="badge drag" title="Sürükleyerek sırala">' + stops.length + '</div>' +
      '<div class="ac"><input class="inp addr" placeholder="Durak adresi (örn. Kadıköy, İstanbul)" autocomplete="off">' +
      '<div class="sug"></div></div>' +
      '<button class="ico" data-detail title="' + stopDetailTitle() + '">' + RP.icons.svg('dots') + '</button>' +
      '<button class="ico" data-pick="' + id + '" title="Haritadan seç">' + RP.icons.svg('pin') + '</button>' +
      '<button class="ico dgr" data-del title="Sil">' + RP.icons.svg('trash') + '</button>' +
    '</div>' +
    '<div class="row detail" hidden style="margin-left:32px">' +
      '<input class="inp numin load work-only" type="number" min="0" step="1" placeholder="Yük" title="Yük (kg/koli)" style="width:72px">' +
      '<input class="inp numin wfrom" type="time" title="En erken" style="width:104px;text-align:left">' +
      '<input class="inp numin wto" type="time" title="En geç" style="width:104px;text-align:left">' +
    '</div>' +
    '<div class="row detail" hidden style="margin-left:32px">' +
      '<input class="inp phone work-only" type="tel" placeholder="Müşteri telefonu (WhatsApp için)" autocomplete="off">' +
      '<button class="ico" data-fav title="Adres defterine kaydet">' + RP.icons.svg('star') + '</button>' +
    '</div>';
  stopsEl.appendChild(wrap);

  var addrEl = wrap.querySelector('input.addr');
  var sugEl = wrap.querySelector('.sug');

  data.destroy = wireAutocomplete(addrEl, sugEl, function(item){
    data.lat = item.lat; data.lon = item.lon; data.label = item.label;
    placeMarker(id, item.lat, item.lon, 'md', String(indexOfStop(id)+1));
    updateStopCount();
  });

  wrap.querySelector('[data-detail]').addEventListener('click', function(){
    var rows = wrap.querySelectorAll('.detail');
    var opening = rows[0].hidden;
    rows.forEach(function(r){ r.hidden = !opening; });
    this.classList.toggle('act', opening);
  });

  wrap.querySelector('.phone').addEventListener('input', function(){
    data.phone = this.value.trim();
  });

  wrap.querySelector('[data-fav]').addEventListener('click', function(){
    if(data.lat == null){ toast('Önce bu durağa bir adres seç', true); return; }
    RP.storage.saveAddress({ label: data.label, lat: data.lat, lon: data.lon }).then(function(){
      toast('Adres defterine eklendi');
      loadAddressBook();
    }).catch(function(err){ toast('Kaydedilemedi: ' + err.message, true); });
  });

  wrap.querySelector('.load').addEventListener('input', function(){
    var v = parseFloat(this.value) || 0;
    data.load = v > 0 ? v : 0;
  });
  wrap.querySelector('.wfrom').addEventListener('input', function(){
    data.windowStart = clockToMin(this.value);
  });
  wrap.querySelector('.wto').addEventListener('input', function(){
    data.windowEnd = clockToMin(this.value);
  });

  wrap.querySelector('[data-del]').addEventListener('click', function(){
    stops = stops.filter(function(s){ return s.id !== id; });
    data.destroy();
    wrap.remove();
    removeMarker(id);
    renumber();
    updateStopCount();
  });

  wrap.querySelector('[data-pick]').addEventListener('click', function(){
    startPicking(id, function(latlon){
      data.lat = latlon.lat; data.lon = latlon.lng;
      data.label = latlon.lat.toFixed(5) + ', ' + latlon.lng.toFixed(5);
      addrEl.value = data.label; addrEl.classList.add('ok');
      placeMarker(id, latlon.lat, latlon.lng, 'md', String(indexOfStop(id)+1));
      updateStopCount();
      RP.geo.reverse(latlon.lat, latlon.lng).then(function(label){
        if(label){ data.label = label; addrEl.value = label; }
      });
    });
  });

  if(prefill){
    data.lat = prefill.lat; data.lon = prefill.lon; data.label = prefill.label || '';
    data.load = prefill.load || 0;
    data.phone = prefill.phone || '';
    if(data.phone) wrap.querySelector('.phone').value = data.phone;
    data.windowStart = prefill.windowStart != null ? prefill.windowStart : null;
    data.windowEnd = prefill.windowEnd != null ? prefill.windowEnd : null;
    addrEl.value = prefill.label; addrEl.classList.add('ok');
    if(data.load) wrap.querySelector('.load').value = data.load;
    if(data.windowStart != null) wrap.querySelector('.wfrom').value = fmtClock(data.windowStart);
    if(data.windowEnd != null) wrap.querySelector('.wto').value = fmtClock(data.windowEnd);
    if(data.load || data.windowStart != null || data.windowEnd != null){
      wrap.querySelector('.detail').hidden = false;
    }
    placeMarker(id, prefill.lat, prefill.lon, 'md', String(indexOfStop(id)+1));
  }

  updateStopCount();
  return data;
}

function indexOfStop(id){ return stops.findIndex(function(s){ return s.id === id; }); }

function clearAllStops(){
  stops.forEach(function(s){
    if(s.destroy) s.destroy();
    removeMarker(s.id);
  });
  stops = [];
  stopsEl.innerHTML = '';
  updateStopCount();
}

function renumber(){
  stopsEl.querySelectorAll('.stopwrap').forEach(function(w, i){
    w.querySelector('.badge').textContent = String(i+1);
    var mk = markers[w.dataset.id];
    if(mk) mk.setIcon(pinIcon('md', String(i+1)));
  });
}

document.getElementById('addStop').addEventListener('click', function(){ addStopRow(); });
addStopRow();
addStopRow();

/* ---------- start / end inputs ---------- */
wireAutocomplete(document.getElementById('startInp'), document.getElementById('startSug'), function(item){
  start = item;
  placeMarker('start', item.lat, item.lon, 'st', 'B');
});
document.querySelector('[data-pick="start"]').addEventListener('click', function(){
  startPicking('start', function(latlon){
    start = { lat: latlon.lat, lon: latlon.lng, label: latlon.lat.toFixed(5)+', '+latlon.lng.toFixed(5) };
    document.getElementById('startInp').value = start.label;
    document.getElementById('startInp').classList.add('ok');
    placeMarker('start', latlon.lat, latlon.lng, 'st', 'B');
    RP.geo.reverse(latlon.lat, latlon.lng).then(function(l){
      if(l){ start.label = l; document.getElementById('startInp').value = l; }
    });
  });
});
document.getElementById('geoBtn').addEventListener('click', function(){
  if(!navigator.geolocation){ toast('Tarayıcı konum desteklemiyor', true); return; }
  toast('Konum alınıyor…');
  navigator.geolocation.getCurrentPosition(function(pos){
    var lat = pos.coords.latitude, lon = pos.coords.longitude;
    start = { lat: lat, lon: lon, label: lat.toFixed(5)+', '+lon.toFixed(5) };
    document.getElementById('startInp').value = start.label;
    document.getElementById('startInp').classList.add('ok');
    placeMarker('start', lat, lon, 'st', 'B');
    RP.geo.reverse(lat, lon).then(function(l){
      if(l){ start.label = l; document.getElementById('startInp').value = l; }
    });
  }, function(){ toast('Konum alınamadı — izin verildiğinden emin ol', true); });
});

wireAutocomplete(document.getElementById('endInp'), document.getElementById('endSug'), function(item){
  end = item;
  placeMarker('end', item.lat, item.lon, 'en', 'V');
});
document.querySelector('[data-pick="end"]').addEventListener('click', function(){
  startPicking('end', function(latlon){
    end = { lat: latlon.lat, lon: latlon.lng, label: latlon.lat.toFixed(5)+', '+latlon.lng.toFixed(5) };
    document.getElementById('endInp').value = end.label;
    document.getElementById('endInp').classList.add('ok');
    placeMarker('end', latlon.lat, latlon.lng, 'en', 'V');
    RP.geo.reverse(latlon.lat, latlon.lng).then(function(l){
      if(l){ end.label = l; document.getElementById('endInp').value = l; }
    });
  });
});
document.getElementById('endMode').addEventListener('change', function(e){
  var v = e.target.value;
  document.getElementById('endSec').hidden = (v !== 'custom');
  if(v !== 'custom'){ end = null; removeMarker('end'); document.getElementById('endInp').value=''; }
});
document.getElementById('metric').addEventListener('click', function(e){
  var b = e.target.closest('button[data-m]');
  if(!b) return;
  this.querySelectorAll('button').forEach(function(x){ x.classList.remove('on'); });
  b.classList.add('on');
});

/* ---------- settings ---------- */
var ttKeyInp = document.getElementById('ttKeyInp');
var ttStatus = document.getElementById('ttStatus');
function updateTtStatus(){
  var k = (localStorage.getItem('tomtom_api_key')||'').trim();
  ttStatus.textContent = k ? 'aktif · trafik' : 'pasif';
  ttStatus.className = 'pill ' + (k ? 'on' : 'off');
}
ttKeyInp.value = (localStorage.getItem('tomtom_api_key')||'');
updateTtStatus();
document.getElementById('ttSaveBtn').addEventListener('click', function(){
  var v = ttKeyInp.value.trim();
  if(v){ localStorage.setItem('tomtom_api_key', v); toast('TomTom key kaydedildi — rotalar trafiğe göre hesaplanacak'); }
  else { localStorage.removeItem('tomtom_api_key'); toast('Key silindi, OSRM (trafiksiz) kullanılacak'); }
  updateTtStatus();
});

/* The published site carries its own Firebase project, so the config box is only
   shown to someone running a copy that has none. */
var fbCfgBlock = document.getElementById('fbCfgBlock');
if(fbCfgBlock) fbCfgBlock.hidden = !!RP.firebaseConfig;
var fbCfgInp = document.getElementById('fbCfgInp');
var fbStatus = document.getElementById('fbStatus');
var histPill = document.getElementById('histPill');
function updateFbStatus(){
  var on = RP.storage.isConfigured();
  fbStatus.textContent = on ? 'aktif' : 'pasif';
  fbStatus.className = 'pill ' + (on ? 'on' : 'off');
  histPill.textContent = on ? 'hazır' : 'Firebase gerekli';
  histPill.className = 'pill ' + (on ? 'on' : 'off');
}
fbCfgInp.value = RP.storage.rawConfig();
updateFbStatus();
document.getElementById('fbSaveBtn').addEventListener('click', function(){
  if(RP.storage.saveConfig(fbCfgInp.value)){
    toast('Firebase yapılandırması kaydedildi');
    updateFbStatus();
    loadHistory();
    startAuth();
  } else {
    toast('Config okunamadı — apiKey ve projectId içeren JSON yapıştır', true);
  }
});
document.getElementById('fbClearBtn').addEventListener('click', function(){
  RP.storage.saveConfig('');
  fbCfgInp.value = '';
  updateFbStatus();
  toast('Firebase yapılandırması temizlendi');
});


/* ---------- drag to reorder ---------- */
/* Pointer events rather than HTML5 drag-and-drop, which does not work on touch. */
(function(){
  var dragging = null, placeholder = null, startY = 0, offsetY = 0;

  stopsEl.addEventListener('pointerdown', function(e){
    var handle = e.target.closest('.badge.drag');
    if(!handle) return;
    var wrap = handle.closest('.stopwrap');
    if(!wrap) return;
    e.preventDefault();

    dragging = wrap;
    var rect = wrap.getBoundingClientRect();
    startY = e.clientY;
    offsetY = e.clientY - rect.top;

    placeholder = document.createElement('div');
    placeholder.className = 'dropslot';
    placeholder.style.height = rect.height + 'px';
    wrap.parentNode.insertBefore(placeholder, wrap.nextSibling);

    wrap.classList.add('dragging');
    wrap.style.width = rect.width + 'px';
    wrap.style.top = rect.top + 'px';
    handle.setPointerCapture(e.pointerId);
  });

  stopsEl.addEventListener('pointermove', function(e){
    if(!dragging) return;
    dragging.style.top = (e.clientY - offsetY) + 'px';

    var rows = Array.prototype.slice.call(stopsEl.querySelectorAll('.stopwrap:not(.dragging)'));
    var after = null;
    rows.forEach(function(r){
      var box = r.getBoundingClientRect();
      if(e.clientY > box.top + box.height / 2) after = r;
    });
    if(after) after.parentNode.insertBefore(placeholder, after.nextSibling);
    else stopsEl.insertBefore(placeholder, stopsEl.firstChild);
  });

  function endDrag(){
    if(!dragging) return;
    placeholder.parentNode.insertBefore(dragging, placeholder);
    placeholder.remove();
    dragging.classList.remove('dragging');
    dragging.style.width = '';
    dragging.style.top = '';
    dragging = null;
    placeholder = null;
    syncStopOrder();
  }
  stopsEl.addEventListener('pointerup', endDrag);
  stopsEl.addEventListener('pointercancel', endDrag);
})();

/* The DOM is the source of truth after a drag; mirror it back into `stops`. */
function syncStopOrder(){
  var order = [];
  stopsEl.querySelectorAll('.stopwrap').forEach(function(w){
    var s = stops.filter(function(x){ return x.id === w.dataset.id; })[0];
    if(s) order.push(s);
  });
  if(order.length === stops.length) stops = order;
  renumber();
}

/* ---------- address book ---------- */
function loadAddressBook(){
  var box = document.getElementById('bookBody');
  if(!box) return;
  RP.storage.listAddressBook().then(function(list){
    if(!list.length){
      box.innerHTML = '<p class="hint" style="margin:0">Henüz kayıtlı adres yok. Bir durağın detay menüsünden yıldız simgesiyle kaydedebilirsin.</p>';
      return;
    }
    box.innerHTML = list.map(function(p){
      return '<div class="histrow" data-add="' + esc(p.id) + '">' +
        '<div style="flex:1;min-width:0"><b>' + esc((p.label||'').split(',')[0]) + '</b>' +
        '<small>' + esc(p.label) + '</small></div>' +
        '<button class="ico sm dgr" data-rm="' + esc(p.id) + '" title="Sil">' + RP.icons.svg('trash') + '</button></div>';
    }).join('');

    box.querySelectorAll('[data-add]').forEach(function(row){
      row.addEventListener('click', function(e){
        if(e.target.closest('[data-rm]')) return;
        var place = list.filter(function(p){ return p.id === row.dataset.add; })[0];
        if(!place) return;
        addStopRow({ lat: place.lat, lon: place.lon, label: place.label });
        toast('Durak eklendi');
      });
    });
    box.querySelectorAll('[data-rm]').forEach(function(b){
      b.addEventListener('click', function(e){
        e.stopPropagation();
        RP.storage.deleteAddress(this.dataset.rm).then(loadAddressBook);
      });
    });
  }).catch(function(){
    box.innerHTML = '<p class="hint" style="margin:0">Adres defteri okunamadı.</p>';
  });
}

var bookAcc = document.getElementById('bookAcc');
if(bookAcc){
  bookAcc.addEventListener('toggle', function(){ if(this.open) loadAddressBook(); });
}


/* ---------- barcode / QR scanning ---------- */
(function(){
  var btn = document.getElementById('scanBtn');
  if(!btn) return;
  var host = document.getElementById('importPreview');
  var stopScan = null;

  btn.addEventListener('click', function(){
    if(stopScan){ stopScan(); stopScan = null; btn.innerHTML = RP.icons.svg('barcode') + 'Barkod'; return; }
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      toast('Bu tarayıcı kamerayı desteklemiyor', true);
      return;
    }
    btn.innerHTML = RP.icons.svg('stop') + 'Taramayı durdur';
    toast('Barkodu çerçeveye getir');

    stopScan = RP.scanner.scan(host, function(raw){
      stopScan = null;
      btn.innerHTML = RP.icons.svg('barcode') + 'Barkod';
      var parsed = RP.scanner.textFromCode(raw);
      if(!parsed){ toast('Kod okunamadı', true); return; }

      if(parsed.coords){
        addStopRow({
          lat: parsed.coords.lat, lon: parsed.coords.lon,
          label: parsed.coords.lat.toFixed(5) + ', ' + parsed.coords.lon.toFixed(5)
        });
        toast('Koordinat okundu, durak eklendi');
        RP.geo.reverse(parsed.coords.lat, parsed.coords.lon).then(function(label){
          if(!label) return;
          var last = stops[stops.length-1];
          if(!last) return;
          last.label = label;
          var row = document.querySelector('.stopwrap[data-id="'+last.id+'"] input.addr');
          if(row) row.value = label;
        });
        return;
      }

      // otherwise treat the payload as an address and geocode it
      toast('Adres aranıyor: ' + parsed.query.slice(0, 40));
      RP.geo.search(parsed.query).then(function(hits){
        if(!hits.length){ toast('Bu koddan adres bulunamadı: ' + parsed.query.slice(0,40), true); return; }
        addStopRow({ lat: hits[0].lat, lon: hits[0].lon, label: hits[0].label });
        toast('Durak eklendi');
      });
    }, function(err){
      stopScan = null;
      btn.innerHTML = RP.icons.svg('barcode') + 'Barkod';
      toast('Kamera açılamadı: ' + err.message, true);
    });
  });
})();



/* ---------- sign-in gate ---------- */
/* Routes have to survive a device change, so the planner is behind an account.
   Flip REQUIRE_AUTH to false to let visitors try it without signing in. */
var REQUIRE_AUTH = true;

(function(){
  var gate = document.getElementById('authGate');
  if(!gate) return;

  var logo = gate.querySelector('.logo');
  if(logo) logo.innerHTML = RP.icons.svg('star');

  document.getElementById('gateLogin').addEventListener('click', function(){
    if(!RP.authUI.open('login')) showSetupNeeded();
  });
  document.getElementById('gateRegister').addEventListener('click', function(){
    if(!RP.authUI.open('register')) showSetupNeeded();
  });

  function showSetupNeeded(){
    document.getElementById('gateText').innerHTML =
      'Bu kopyada Firebase bağlantısı tanımlı değil, bu yüzden hesap açılamıyor. ' +
      'Site sahibiysen <a href="kurulum.html">kurulum sayfasındaki</a> adımları izleyip ' +
      '<code>js/firebase-config.js</code> dosyasını doldur.';
  }

  function refresh(){
    if(!REQUIRE_AUTH){ gate.hidden = true; return; }
    if(!RP.auth.available()){
      gate.hidden = false;
      showSetupNeeded();
      return;
    }
    gate.hidden = RP.auth.isSignedIn();
    if(!gate.hidden) map.invalidateSize();
  }

  if(RP.auth.available()){
    RP.auth.onChange(refresh);
    // the persisted session resolves a moment after load
    setTimeout(refresh, 50);
  }
  refresh();
})();

/* ---------- driver accounts ---------- */
/* Registering as a driver used to change nothing but a label in the header: the
   planner opened as usual and no link led to the driver's own screen. */
function isDriver(){
  var p = RP.auth.available() ? RP.auth.profile() : null;
  return !!(p && p.role === 'driver');
}

(function(){
  var hint = document.getElementById('driverHint');
  if(!hint || !RP.auth.available()) return;

  var SENT = 'rp_drv_sent';
  function alreadySent(){
    try { return sessionStorage.getItem(SENT) === '1'; } catch(e){ return false; }
  }

  // the profile arrives after the session does, so this runs again once it lands
  RP.auth.onChange(function(){
    var drv = isDriver();
    hint.hidden = !drv;
    // send them to their screen once per session; coming back here keeps them here
    if(drv && !alreadySent()){
      try { sessionStorage.setItem(SENT, '1'); } catch(e){}
      location.href = 'driver.html';
    }
  });
})();

/* ---------- usage mode ---------- */
/* Work mode is the courier / haulier planner. Personal mode is a driver planning
   their own trip: the fleet, capacity, shift and delivery controls go away. Asked
   once, then remembered; changeable any time from the Kullanım row. */
(function(){
  var modeGate = document.getElementById('modeGate');
  var seg = document.getElementById('modeSeg');
  var usageHint = document.getElementById('usageHint');
  if(!modeGate || !seg) return;

  /* Writing the answer onto the account settles it everywhere, not just in this
     browser's localStorage. Best effort: a failure here changes nothing visible. */
  function settle(mode){
    var prof = RP.auth.available() ? RP.auth.profile() : null;
    if(prof && prof.usage !== mode && RP.auth.updateProfile){
      RP.auth.updateProfile({ usage: mode }).catch(function(){});
    }
  }

  function dismissHint(){
    if(usageHint) usageHint.hidden = true;
    try { localStorage.setItem('rp_usage_hint', 'seen'); } catch(e){}
  }

  function explainInferredMode(role){
    if(!usageHint) return;
    try { if(localStorage.getItem('rp_usage_hint') === 'seen') return; } catch(e){}
    var el = usageHint.querySelector('#usageHintRole');
    if(el) el.textContent = role === 'driver' ? 'şoför' : 'planlayıcı';
    usageHint.hidden = false;
  }

  modeGate.querySelector('.logo').innerHTML = RP.icons.svg('star');

  function syncSeg(){
    var m = RP.mode.isPersonal() ? 'personal' : 'work';
    seg.querySelectorAll('button').forEach(function(b){
      b.classList.toggle('on', b.dataset.mode === m);
    });
  }

  function ask(){
    // never stack two dialogs: the sign-in gate has to clear first
    var authGate = document.getElementById('authGate');
    if(authGate && !authGate.hidden) return;
    // a driver does not plan their own trips here, so the question has no meaning
    if(isDriver()){ RP.mode.set('work'); modeGate.hidden = true; return; }
    // accounts registered after the usage step already carry the answer, so the
    // dialog is only for older accounts and anyone who never chose
    var prof = RP.auth.available() ? RP.auth.profile() : null;

    // answered at registration: nothing to ask, nothing to explain
    if(prof && prof.usage){
      if(RP.mode.get() === null) RP.mode.set(prof.usage);
      modeGate.hidden = true;
      return;
    }

    /* Registered before the usage question existed. The account still says whether
       it was opened as a planner or a driver, and that only happened in the
       business flow — so infer the mode and say why, instead of asking again. */
    if(prof && prof.role && RP.mode.get() === null){
      RP.mode.set('work');
      explainInferredMode(prof.role);
      modeGate.hidden = true;
      return;
    }

    modeGate.hidden = RP.mode.get() !== null;
    if(!modeGate.hidden) map.invalidateSize();
  }

  modeGate.querySelectorAll('.modepick button').forEach(function(b){
    b.addEventListener('click', function(){
      RP.mode.set(b.dataset.mode);
      settle(b.dataset.mode);
      modeGate.hidden = true;
      map.invalidateSize();
    });
  });

  seg.querySelectorAll('button').forEach(function(b){
    b.addEventListener('click', function(){
      RP.mode.set(b.dataset.mode);
      settle(b.dataset.mode);   // an explicit choice answers the question for good
      dismissHint();
    });
  });

  if(usageHint){
    var ok = document.getElementById('usageHintOk');
    if(ok) ok.addEventListener('click', function(){
      dismissHint();
      settle(RP.mode.isPersonal() ? 'personal' : 'work');
    });
  }

  RP.mode.onChange(function(){ syncSeg(); refreshStopDetailTitles(); });
  syncSeg();

  // the persisted session resolves a moment after load, same as the sign-in gate
  if(RP.auth.available()) RP.auth.onChange(function(){ setTimeout(ask, 60); });
  setTimeout(ask, 120);
})();

/* ---------- deferred (next-day) stops ---------- */
function tomorrowStops(){
  try { return JSON.parse(localStorage.getItem('rp_tomorrow') || '[]'); }
  catch(e){ return []; }
}

function showTomorrowBanner(){
  var host = document.getElementById('tomorrowBox');
  if(!host) return;
  var parked = tomorrowStops();
  if(!parked.length){ host.innerHTML = ''; return; }
  host.innerHTML =
    '<div class="save warn" style="margin-bottom:12px">' + RP.icons.svg('moon') + 'Önceki plandan devreden <b>' + parked.length +
    '</b> durak var. <button class="linkbtn" id="loadTomorrow">Plana ekle</button> · ' +
    '<button class="linkbtn" id="dropTomorrow">Sil</button></div>';

  document.getElementById('loadTomorrow').addEventListener('click', function(){
    parked.forEach(function(p){ addStopRow(p); });
    localStorage.removeItem('rp_tomorrow');
    renumber();
    showTomorrowBanner();
    toast(parked.length + ' durak plana eklendi');
  });
  document.getElementById('dropTomorrow').addEventListener('click', function(){
    localStorage.removeItem('rp_tomorrow');
    showTomorrowBanner();
  });
}
showTomorrowBanner();

/* ---------- fuel settings ---------- */
(function(){
  var lp = document.getElementById('fuelLp100');
  var pr = document.getElementById('fuelPrice');
  if(!lp || !pr) return;
  var f = fuelSettings();
  lp.value = f.lp100;
  pr.value = f.price;
  lp.addEventListener('change', function(){
    var v = parseFloat(this.value);
    if(v > 0) localStorage.setItem('rp_fuel_lp100', v);
    if(lastResult) renderResult(lastResult);
  });
  pr.addEventListener('change', function(){
    var v = parseFloat(this.value);
    if(v > 0) localStorage.setItem('rp_fuel_price', v);
    if(lastResult) renderResult(lastResult);
  });
})();

/* ---------- account ---------- */
/* Signing in is optional: without it the planner works exactly as before, and an
   account only adds history, sharing, driver assignment and delivery tracking. */
function startAuth(){
  if(!RP.auth.available()) return;
  RP.auth.start();
}

RP.authUI.mountHeader(document.getElementById('authSlot'), {
  onUnavailable: function(){
    toast('Önce Ayarlar bölümünden Firebase yapılandırmasını ekle', true);
    var acc = document.querySelectorAll('details.acc')[1];
    if(acc){ acc.open = true; acc.scrollIntoView({ block: 'nearest' }); }
  },
  onSignedIn: function(){
    toast('Giriş yapıldı');
    loadHistory();
  },
  onSignedOut: function(){
    toast('Çıkış yapıldı');
    loadHistory();
  }
});
startAuth();

/* ---------- CSV import ---------- */
document.getElementById('csvBtn').addEventListener('click', function(){
  document.getElementById('csvFile').click();
});
document.getElementById('csvFile').addEventListener('change', function(e){
  var file = e.target.files && e.target.files[0];
  if(!file) return;
  var problem = RP.upload.check(file, 'text');
  if(problem){ toast(problem, true); e.target.value = ''; return; }
  var reader = new FileReader();
  reader.onload = function(){
    var rows = RP.importers.parse(reader.result);
    if(!rows.length){ toast('CSV içinde adres bulunamadı', true); return; }
    showImportPreview(rows.map(function(r){
      return { text: r.address, load: r.load, phone: r.phone, windowStart: r.windowStart, windowEnd: r.windowEnd };
    }), 'CSV');
  };
  reader.readAsText(file, 'utf-8');
  e.target.value = '';
});

/* ---------- photo (OCR) import ---------- */
document.getElementById('photoBtn').addEventListener('click', function(){
  document.getElementById('photoFile').click();
});
document.getElementById('photoFile').addEventListener('change', function(e){
  var file = e.target.files && e.target.files[0];
  if(!file) return;
  var problem = RP.upload.check(file, 'image');
  if(problem){ toast(problem, true); e.target.value = ''; return; }
  var box = document.getElementById('importPreview');
  box.innerHTML = '<div class="card"><span class="spin"></span>Fotoğraf okunuyor… <span id="ocrPct">0%</span></div>';
  RP.ocr.recognize(file, function(pct){
    var el = document.getElementById('ocrPct');
    if(el) el.textContent = pct + '%';
  }).then(function(lines){
    if(!lines.length){
      box.innerHTML = '';
      toast('Fotoğrafta adres benzeri satır bulunamadı', true);
      return;
    }
    showImportPreview(lines.map(function(t){ return { text: t }; }), 'Fotoğraf');
  }).catch(function(err){
    box.innerHTML = '';
    toast(err.message || 'OCR başarısız', true);
  });
  e.target.value = '';
});

/* OCR and CSV output is reviewed by the user before anything is geocoded. */
function showImportPreview(items, sourceLabel){
  var box = document.getElementById('importPreview');
  box.innerHTML =
    '<div class="card">' +
      '<label class="lbl">' + esc(sourceLabel) + ' — ' + items.length + ' satır bulundu</label>' +
      '<p class="hint" style="margin-top:0">Yanlış satırları düzelt veya sil, sonra “Adresleri bul”a bas.</p>' +
      '<div class="imglist" id="impList"></div>' +
      '<div class="btnrow" style="margin-top:10px">' +
        '<button class="btn ghost" id="impCancel">Vazgeç</button>' +
        '<button class="btn primary" id="impGo" style="padding:9px">Adresleri bul</button>' +
      '</div>' +
    '</div>';

  var list = document.getElementById('impList');
  items.forEach(function(it, i){
    var row = document.createElement('div');
    row.className = 'row';
    row.innerHTML =
      '<div class="badge">' + (i+1) + '</div>' +
      '<input class="inp" value="' + esc(it.text) + '">' +
      '<button class="ico dgr sm" title="Sil">' + RP.icons.svg('trash') + '</button>';
    row.querySelector('button').addEventListener('click', function(){ row.remove(); });
    row.dataset.load = it.load || 0;
    row.dataset.phone = it.phone || '';
    row.dataset.wstart = it.windowStart == null ? '' : it.windowStart;
    row.dataset.wend = it.windowEnd == null ? '' : it.windowEnd;
    list.appendChild(row);
  });

  document.getElementById('impCancel').addEventListener('click', function(){ box.innerHTML = ''; });
  document.getElementById('impGo').addEventListener('click', function(){
    var rows = Array.prototype.slice.call(list.querySelectorAll('.row'));
    var entries = rows.map(function(r){
      return {
        text: r.querySelector('input').value.trim(),
        load: parseFloat(r.dataset.load) || 0,
        phone: r.dataset.phone || '',
        windowStart: r.dataset.wstart === '' ? null : parseInt(r.dataset.wstart,10),
        windowEnd: r.dataset.wend === '' ? null : parseInt(r.dataset.wend,10)
      };
    }).filter(function(x){ return x.text.length > 2; });

    if(!entries.length){ toast('Eklenecek satır kalmadı', true); return; }

    this.disabled = true;
    this.innerHTML = '<span class="spin"></span>Adresler bulunuyor 0/' + entries.length;
    var btn = this;

    RP.geo.geocodeMany(entries.map(function(x){ return x.text; }), function(done, total){
      btn.innerHTML = '<span class="spin"></span>Adresler bulunuyor ' + done + '/' + total;
    }).then(function(results){
      var added = 0, failed = [];
      results.forEach(function(res, i){
        if(res.hit){
          addStopRow({
            lat: res.hit.lat, lon: res.hit.lon, label: res.hit.label,
            load: entries[i].load, phone: entries[i].phone,
            windowStart: entries[i].windowStart, windowEnd: entries[i].windowEnd
          });
          added++;
        } else {
          failed.push(res.query);
        }
      });
      box.innerHTML = '';
      renumber();
      updateStopCount();
      toast(added + ' durak eklendi' + (failed.length ? ', ' + failed.length + ' adres bulunamadı' : ''), failed.length > 0);
    });
  });
}

/* ---------- optimization ---------- */
var btnRun = document.getElementById('run');
var resultEl = document.getElementById('result');

btnRun.addEventListener('click', function(){
  runOptimization().catch(function(err){
    console.error(err);
    toast(err.message || 'Bir hata oluştu', true);
  }).then(function(){
    btnRun.disabled = false;
    btnRun.textContent = 'Rotayı Optimize Et';
  });
});

function stopDetailTitle(){
  return RP.mode.isPersonal() ? 'Zaman aralığı' : 'Yük / zaman aralığı';
}

function refreshStopDetailTitles(){
  document.querySelectorAll('#stops [data-detail]').forEach(function(b){
    b.title = stopDetailTitle();
  });
}

function readOptions(){
  var metricBtn = document.querySelector('#metric button.on');
  var solo = RP.mode.isPersonal();
  return {
    endMode: document.getElementById('endMode').value,
    metric: metricBtn ? metricBtn.dataset.m : 'distance',
    // personal mode hides these; reading them anyway would let a vehicle count left
    // over from work mode silently split a private trip across imaginary vehicles
    vehicleCount: solo ? 1 : Math.min(6, Math.max(1, parseInt(document.getElementById('vehicleCount').value,10) || 1)),
    capacity: solo ? 0 : Math.max(0, parseFloat(document.getElementById('capacity').value) || 0),
    // 00:00 is a valid night-shift start; `|| 540` would turn it into 09:00
    startTime: (function(){
      var t = clockToMin(document.getElementById('startTime').value);
      return t == null ? 540 : t;
    })(),
    shiftMinutes: solo ? 0 : Math.max(0, (parseFloat(document.getElementById('shiftHours').value) || 0) * 60)
  };
}

function runOptimization(){
  if(!start || start.lat == null){ toast('Lütfen bir başlangıç noktası seç', true); return Promise.resolve(); }
  var validStops = stops.filter(function(s){ return s.lat != null && s.lon != null; });
  if(validStops.length < 1){ toast('En az 1 durak ekle', true); return Promise.resolve(); }

  var opt = readOptions();
  if(opt.endMode === 'custom' && (!end || end.lat == null)){ toast('Varış adresini seç', true); return Promise.resolve(); }

  btnRun.disabled = true;
  btnRun.innerHTML = '<span class="spin"></span>Hesaplanıyor…';

  var assignment = RP.optimize.assignVehicles(start, validStops, opt.vehicleCount, opt.capacity);
  var groups = assignment.groups;
  if(assignment.overflow){
    toast('Bazı duraklar kapasiteyi aşıyor — araç sayısını veya kapasiteyi artır', true);
  }

  layerRoute.clearLayers();
  layerMarkers.clearLayers();
  markers = {};

  var vehicles = [];
  var chain = Promise.resolve();

  groups.forEach(function(groupStops, vi){
    if(!groupStops.length) return;
    chain = chain.then(function(){
      return planOneVehicle(groupStops, opt, vi).then(function(v){ vehicles.push(v); });
    });
  });

  return chain.then(function(){
    lastResult = {
      vehicles: vehicles,
      totalDistance: vehicles.reduce(function(s,v){ return s + v.distance; }, 0),
      totalDuration: vehicles.reduce(function(s,v){ return s + v.duration; }, 0),
      naiveCost: vehicles.reduce(function(s,v){ return s + (v.naiveCost||0); }, 0),
      optimisedCost: vehicles.reduce(function(s,v){ return s + (v.optimisedCost||0); }, 0),
      options: opt
    };
    drawResult(lastResult);
    renderResult(lastResult);
  });
}

function planOneVehicle(groupStops, opt, vehicleIndex){
  var points = [{lat:start.lat, lon:start.lon}];
  groupStops.forEach(function(s){ points.push({lat:s.lat, lon:s.lon}); });

  var lockEnd = false, fixedEndIdx = null;
  if(opt.endMode === 'start'){
    points.push({lat:start.lat, lon:start.lon});
    fixedEndIdx = points.length - 1; lockEnd = true;
  } else if(opt.endMode === 'custom'){
    points.push({lat:end.lat, lon:end.lon});
    fixedEndIdx = points.length - 1; lockEnd = true;
  }

  // stop metadata indexed the same way as `points`, so penalties can see windows
  var metaByIdx = points.map(function(_, i){
    return (i === 0 || (lockEnd && i === fixedEndIdx)) ? null : groupStops[i-1];
  });

  return RP.routing.roadMatrix(points, opt.metric).then(function(mx){
    // "Süre" orders by travel minutes, "Mesafe" by kilometres
    var costMatrix = opt.metric === 'duration' ? mx.dur : mx.dist;

    var penalty = null;
    var hasWindows = groupStops.some(function(s){ return s.windowStart != null || s.windowEnd != null; });
    if(hasWindows){
      // scaled to the cost matrix's unit so the penalty stays comparable to travel cost
      var penaltyWeight = opt.metric === 'duration' ? 0.5 : 0.3;
      penalty = function(order){
        return RP.optimize.timeWindowPenalty(metaByIdx, mx.dur, order, opt.startTime, 5) * penaltyWeight;
      };
    }

    var order = RP.optimize.solveOrder(points, costMatrix, lockEnd, fixedEndIdx, penalty);

    /* What the same stops would have cost visited in the order they were typed —
       the baseline the savings figure is measured against. */
    var naiveOrder = points.map(function(_, i){ return i; });
    if(lockEnd){
      naiveOrder = naiveOrder.filter(function(i){ return i !== fixedEndIdx; });
      naiveOrder.push(fixedEndIdx);
    }
    var naiveCost = RP.optimize.pathCost(naiveOrder, mx.dist);
    var optimisedCost = RP.optimize.pathCost(order, mx.dist);

    var seq = order.map(function(idx){
      if(idx === 0) return { kind:'start', lat:start.lat, lon:start.lon, label:start.label || 'Başlangıç' };
      if(lockEnd && idx === fixedEndIdx){
        return opt.endMode === 'start'
          ? { kind:'end', lat:start.lat, lon:start.lon, label:(start.label||'Başlangıç') + ' (dönüş)' }
          : { kind:'end', lat:end.lat, lon:end.lon, label:end.label || 'Varış' };
      }
      var s = groupStops[idx-1];
      return {
        kind:'stop', lat:s.lat, lon:s.lon, label:s.label || '',
        load: s.load || 0, phone: s.phone || '',
        stopRef: s.id,          // planner-side row id, used when deferring stops
        windowStart: s.windowStart, windowEnd: s.windowEnd
      };
    });

    var straightKm = RP.optimize.pathCost(order, RP.optimize.haversineMatrix(points));

    return RP.routing.computeRoute(seq, function(){
      toast('TomTom yanıt vermedi, OSRM ile hesaplanıyor', true);
    }, opt.metric).then(function(route){
      return buildVehicle(seq, route, opt, vehicleIndex, mx.real, null, naiveCost, optimisedCost);
    }).catch(function(err){
      console.error(err);
      toast('Yol rotası alınamadı, düz çizgiyle gösteriliyor', true);
      return buildVehicle(seq, null, opt, vehicleIndex, mx.real, straightKm, naiveCost, optimisedCost);
    });
  });
}

function buildVehicle(seq, route, opt, vehicleIndex, realMatrix, straightKm, naiveCost, optimisedCost){
  var distance = route ? route.distance : straightKm*1000;
  var duration = route ? route.duration : (straightKm/40)*3600;
  var legDur = route ? (route.legDurations || []) : seq.slice(1).map(function(){ return duration/(seq.length-1); });

  var etas = RP.optimize.arrivalTimes(
    seq.map(function(_,i){ return i; }),
    legDur, opt.startTime,
    seq, 5
  );

  var stopNo = 0;
  var shiftEnd = opt.shiftMinutes ? opt.startTime + opt.shiftMinutes : null;
  seq.forEach(function(p, i){
    p.eta = etas[i];
    if(p.kind === 'stop'){ stopNo++; p.stopNo = stopNo; }
    p.late = (p.windowEnd != null && p.eta > p.windowEnd);
    // beyond the shift the driver would be working overtime — flag for deferral
    p.overflow = !!(shiftEnd && p.kind === 'stop' && p.eta > shiftEnd);
  });

  return {
    color: VEHICLE_COLORS[vehicleIndex % VEHICLE_COLORS.length],
    steps: seq,
    coordinates: route ? route.coordinates : seq.map(function(p){ return [p.lon, p.lat]; }),
    hasRoad: !!route,
    traffic: route ? route.traffic : false,
    trafficDelay: route ? (route.trafficDelay || 0) : 0,
    trafficSections: route ? (route.trafficSections || []) : [],
    realMatrix: realMatrix,
    distance: distance,
    duration: duration,
    distanceText: fmtKm(distance),
    durationText: fmtDur(duration),
    naiveCost: naiveCost || 0,
    optimisedCost: optimisedCost || 0,
    load: seq.reduce(function(s,p){ return s + (p.load||0); }, 0),
    lateCount: seq.filter(function(p){ return p.late; }).length,
    overflowCount: seq.filter(function(p){ return p.overflow; }).length
  };
}


/* TomTom grades congestion 1-4; colour the map the way drivers expect. */
function trafficColor(magnitude){
  if(magnitude >= 4) return '#7f1d1d';   // closure / standstill
  if(magnitude === 3) return '#dc2626';  // major
  if(magnitude === 2) return '#f97316';  // moderate
  return '#f59e0b';                      // minor
}
function trafficLabel(magnitude){
  if(magnitude >= 4) return 'Yol kapalı / durma noktasında';
  if(magnitude === 3) return 'Yoğun trafik';
  if(magnitude === 2) return 'Orta yoğunluk';
  return 'Hafif yavaşlama';
}

function drawResult(result){
  layerRoute.clearLayers();
  layerMarkers.clearLayers();
  markers = {};
  var allPts = [];

  result.vehicles.forEach(function(v){
    var latlngs = v.coordinates.map(function(c){ return [c[1], c[0]]; });
    allPts = allPts.concat(latlngs);
    L.polyline(latlngs, {
      color: v.color, weight: 5, opacity: .85, lineJoin: 'round',
      dashArray: v.hasRoad ? null : '8 8'
    }).addTo(layerRoute);

    // congested stretches drawn on top so the driver sees where the delay is
    (v.trafficSections || []).forEach(function(sec){
      var part = latlngs.slice(sec.start, sec.end + 1);
      if(part.length < 2) return;
      L.polyline(part, {
        color: trafficColor(sec.magnitude), weight: 7, opacity: .95, lineJoin: 'round'
      }).addTo(layerRoute)
        .bindPopup('<b>' + trafficLabel(sec.magnitude) + '</b><br>' +
          (sec.delay ? 'Gecikme: ' + fmtDur(sec.delay) + '<br>' : '') +
          (sec.speed != null ? 'Ortalama hız: ' + Math.round(sec.speed) + ' km/s' : ''));
    });

    v.steps.forEach(function(p){
      var cls = p.kind === 'start' ? 'st' : (p.kind === 'end' ? 'en' : 'md');
      var lbl = p.kind === 'start' ? 'B' : (p.kind === 'end' ? 'V' : String(p.stopNo));
      var icon = p.kind === 'stop' ? pinIcon('md', lbl, v.color) : pinIcon(cls, lbl);
      L.marker([p.lat, p.lon], { icon: icon })
        .bindPopup('<b>' + (p.kind==='start'?'Başlangıç':p.kind==='end'?'Varış':'Durak '+p.stopNo) + '</b><br>' +
                   esc(p.label) + '<br><small>Tahmini varış: ' + fmtClock(p.eta) + '</small>')
        .addTo(layerMarkers);
    });
  });

  if(allPts.length) map.fitBounds(L.latLngBounds(allPts), {padding:[40,40], maxZoom: MAX_FIT_ZOOM});
}


/* ---------- cost + emission estimates ---------- */
/* Defaults sized for a small delivery van; the user can change both in Settings. */
function fuelSettings(){
  var c = parseFloat(localStorage.getItem('rp_fuel_lp100')) || 9.5;
  var p = parseFloat(localStorage.getItem('rp_fuel_price')) || 45;
  return { lp100: c, price: p };
}

/* Diesel: ~2.68 kg CO2 per litre burned (well-established combustion figure). */
var CO2_PER_LITRE = 2.68;

function costBlock(distanceMeters){
  var f = fuelSettings();
  var km = distanceMeters / 1000;
  var litres = km * f.lp100 / 100;
  return {
    litres: litres,
    cost: litres * f.price,
    co2: litres * CO2_PER_LITRE
  };
}

function savingsBlock(result){
  var base = result.naiveCost || 0;      // km, stops in the order they were typed
  var opt = result.optimisedCost || 0;   // km, after optimisation
  if(base <= 0 || opt <= 0 || opt >= base) return null;
  var pct = Math.round((1 - opt / base) * 100);
  if(pct < 1) return null;
  return { percent: pct, savedKm: base - opt };
}

function renderResult(result){
  var anyTraffic = result.vehicles.some(function(v){ return v.traffic; });
  var totalDelay = result.vehicles.reduce(function(s,v){ return s + (v.trafficDelay||0); }, 0);
  var totalLate = result.vehicles.reduce(function(s,v){ return s + v.lateCount; }, 0);
  var noRoad = result.vehicles.some(function(v){ return !v.hasRoad; });
  var realMatrix = result.vehicles.some(function(v){ return v.realMatrix; });

  /* How much of the route is congested, and how bad. */
  var sections = result.vehicles.reduce(function(acc, v){
    return acc.concat(v.trafficSections || []);
  }, []);
  var worst = sections.reduce(function(m, s){ return Math.max(m, s.magnitude || 0); }, 0);
  var jamBadge = sections.length
    ? '<div class="save warn">' + RP.icons.svg('traffic') +
      sections.length + ' noktada trafik yoğunluğu var — haritada ' +
      '<b style="color:' + trafficColor(worst) + '">renkli</b> işaretlendi.' +
      '<div class="legend">' +
        '<span><i style="background:#f59e0b"></i>hafif</span>' +
        '<span><i style="background:#f97316"></i>orta</span>' +
        '<span><i style="background:#dc2626"></i>yoğun</span>' +
        '<span><i style="background:#7f1d1d"></i>durma/kapalı</span>' +
      '</div></div>'
    : '';

  var badge;
  if(noRoad){
    badge = '<div class="save zero">Yol servisine ulaşılamadı — mesafe kuş uçuşu tahmindir.</div>';
  } else if(anyTraffic){
    badge = '<div class="save' + (totalDelay > 60 ? '' : ' zero') + '">' + RP.icons.svg('traffic') + 'Canlı trafik dahil' +
      (totalDelay > 60 ? ' — trafik nedeniyle +' + fmtDur(totalDelay) : ', trafik akıcı') +
      (realMatrix ? ' · sıralama gerçek yol mesafesine göre' : '') +
      ' · ' + (result.options.metric === 'distance' ? 'en kısa yol' : 'en hızlı yol') + '</div>';
  } else {
    badge = '<div class="save zero">Trafiksiz tahmindir (OSRM). Canlı trafik için TomTom key ekle.</div>';
  }

  var save = savingsBlock(result);
  var savingsBadge = save
    ? '<div class="save">' + RP.icons.svg('trend') + 'Optimize sıralama <b>%' + save.percent + '</b> daha kısa — ' +
      'girilen sırayla ' + fmtKm(save.savedKm * 1000) + ' fazla yol yapılacaktı.</div>'
    : '';

  var money = costBlock(result.totalDistance);
  var costBadge = '<div class="save zero">' + RP.icons.svg('fuel') + '~' + money.litres.toFixed(1).replace('.', ',') + ' L · ' +
    '~' + Math.round(money.cost).toLocaleString('tr-TR') + ' ₺ yakıt · ' +
    '~' + money.co2.toFixed(1).replace('.', ',') + ' kg CO₂' +
    '<small style="display:block;color:var(--muted);margin-top:3px">Ayarlar bölümünden tüketim ve litre fiyatını değiştirebilirsin.</small></div>';

  var totalOverflow = result.vehicles.reduce(function(s,v){ return s + (v.overflowCount||0); }, 0);
  var overflowBadge = totalOverflow > 0
    ? '<div class="save warn">' + RP.icons.svg('moon') + totalOverflow + ' durak vardiya süresini aşıyor. ' +
      '<button class="linkbtn" id="deferBtn">Bu durakları yarına aktar</button></div>'
    : '';

  var lateBadge = totalLate > 0
    ? '<div class="save warn">' + RP.icons.svg('clock') + totalLate + ' durakta zaman aralığı aşılıyor — araç sayısını artırmayı veya çıkış saatini öne almayı dene.</div>'
    : '';

  var vehiclesHtml = result.vehicles.map(function(v, vi){
    var steps = v.steps.map(function(p){
      var cls = p.kind==='start' ? 's' : (p.kind==='end' ? 'e' : '');
      var num = p.kind==='start' ? 'B' : (p.kind==='end' ? 'V' : p.stopNo);
      var title = p.kind==='start' ? 'Başlangıç' : (p.kind==='end' ? 'Varış' : ('Durak ' + p.stopNo));
      var extra = '';
      if(p.load) extra += ' · ' + p.load + ' yük';
      var win = windowText(p.windowStart, p.windowEnd);
      if(win) extra += ' · ' + win;
      return '<li><div class="num '+cls+'">'+num+'</div><div class="stp">' +
        '<b>'+title+'</b>' +
        '<small>'+esc(p.label)+'</small>' +
        '<span class="'+(p.late?'late':'eta')+'">' + RP.icons.svg('clock') + fmtClock(p.eta) + (p.late ? ' — geç kalınıyor' : '') + esc(extra) + '</span>' +
        '</div></li>';
    }).join('');

    return '<div class="card">' +
      '<div class="vhead">' +
        '<span class="vdot" style="background:'+v.color+'"></span>' +
        '<b style="font-size:13px">Araç ' + (vi+1) + '</b>' +
        '<span class="pill off">' + v.distanceText + ' · ' + v.durationText + (v.load ? ' · ' + v.load + ' yük' : '') + '</span>' +
      '</div>' +
      '<ol class="steps">' + steps + '</ol>' +
    '</div>';
  }).join('');

  resultEl.innerHTML =
    '<div class="card">' +
      '<div class="stats">' +
        '<div class="stat"><b>' + fmtKm(result.totalDistance) + '</b><span>Toplam mesafe</span></div>' +
        '<div class="stat"><b>' + fmtDur(result.totalDuration) + '</b><span>Toplam süre</span></div>' +
      '</div>' + badge + jamBadge + savingsBadge + costBadge + overflowBadge + lateBadge +
      '<div class="btnrow" style="margin-top:10px">' +
        '<button class="btn ghost" id="printBtn">' + RP.icons.svg('printer') + 'Yazdır / PDF</button>' +
        '<button class="btn ghost" id="saveBtn">' + RP.icons.svg('cloud') + 'Kaydet &amp; paylaş</button>' +
      '</div>' +
      '<div id="shareBox"></div>' +
    '</div>' + vehiclesHtml;

  var deferBtn = document.getElementById('deferBtn');
  if(deferBtn){
    deferBtn.addEventListener('click', function(){
      /* Overflow stops leave today's plan and are parked for the next run; the
         banner on load offers to bring them back. */
      /* Matched by stop id, not by coordinates: two parcels for the same building
         share a lat/lon, and coordinate matching removed BOTH from the plan while
         parking only one — silently losing a delivery. */
      var moved = [], movedIds = {};
      result.vehicles.forEach(function(v){
        v.steps.forEach(function(p){
          if(!p.overflow) return;
          moved.push({
            label: p.label, lat: p.lat, lon: p.lon,
            load: p.load || 0, phone: p.phone || '',
            windowStart: p.windowStart == null ? null : p.windowStart,
            windowEnd: p.windowEnd == null ? null : p.windowEnd
          });
          if(p.stopRef) movedIds[p.stopRef] = true;
        });
      });
      if(!moved.length) return;

      var keep = stops.filter(function(s){ return !movedIds[s.id]; });
      try {
        var parked = JSON.parse(localStorage.getItem('rp_tomorrow') || '[]');
        localStorage.setItem('rp_tomorrow', JSON.stringify(parked.concat(moved)));
      } catch(e){}

      clearAllStops();
      keep.forEach(function(s){ addStopRow(s); });
      renumber();
      resultEl.innerHTML = '';
      layerRoute.clearLayers();
      toast(moved.length + ' durak yarına aktarıldı — sonraki açılışta hatırlatılacak');
      showTomorrowBanner();
    });
  }

  document.getElementById('printBtn').addEventListener('click', function(){
    RP.pdf.print(lastResult, {
      date: new Date().toLocaleDateString('tr-TR'),
      startTime: fmtClock(lastResult.options.startTime),
      totalDistance: fmtKm(lastResult.totalDistance),
      totalDuration: fmtDur(lastResult.totalDuration)
    });
  });
  document.getElementById('saveBtn').addEventListener('click', saveAndShare);
}

/* ---------- save / share / live tracking ---------- */
function decimate(coords, max){
  if(coords.length <= max) return coords;
  var step = Math.ceil(coords.length / max);
  var out = coords.filter(function(_, i){ return i % step === 0; });
  if(out[out.length-1] !== coords[coords.length-1]) out.push(coords[coords.length-1]);
  return out;
}

function saveAndShare(){
  if(!lastResult){ return; }
  if(!RP.storage.isConfigured()){
    toast('Önce Ayarlar bölümünden Firebase yapılandırmasını ekle', true);
    return;
  }
  var btn = document.getElementById('saveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>Kaydediliyor…';

  var payload = {
    // link ile paylaşıldığı için güvenlik kurallarında herkese okunur işaretlenir
    shared: true,
    start: start,
    end: end,
    options: lastResult.options,
    totalDistance: lastResult.totalDistance,
    totalDuration: lastResult.totalDuration,
    vehicles: lastResult.vehicles.map(function(v, vi){
      return {
        color: v.color,
        distance: v.distance,
        duration: v.duration,
        load: v.load,
        /* Firestore rejects nested arrays, so the [lon,lat] pairs are stored as
           objects. Naming the fields also removes the lat/lon order ambiguity. */
        coordinates: decimate(v.coordinates, 400).map(function(c){
          return { lat: c[1], lon: c[0] };
        }),
        /* Sections are stored as real coordinates, not point indices: the
           coordinate list above is decimated for storage, which would shift any
           index. The driver screen needs the jam's position, not its index. */
        trafficSections: (v.trafficSections || []).map(function(sec){
          var a = v.coordinates[sec.start] || [];
          var b = v.coordinates[sec.end] || [];
          return {
            lat: a[1], lon: a[0],
            endLat: b[1], endLon: b[0],
            delay: sec.delay || 0,
            magnitude: sec.magnitude || 0,
            speed: sec.speed == null ? null : sec.speed
          };
        }).filter(function(sec){
          // any undefined here would make Firestore reject the whole route
          return sec.lat != null && sec.lon != null && sec.endLat != null && sec.endLon != null;
        }),
        steps: v.steps.map(function(p, si){
          return {
            // stable per-route id so a delivery record can point at this stop
            stopId: 'v' + vi + 's' + si,
            kind: p.kind, lat: p.lat, lon: p.lon, label: p.label,
            phone: p.phone || null,
            load: p.load || 0, stopNo: p.stopNo || null,
            windowStart: p.windowStart == null ? null : p.windowStart,
            windowEnd: p.windowEnd == null ? null : p.windowEnd,
            eta: p.eta == null ? null : p.eta, late: !!p.late
          };
        })
      };
    })
  };

  RP.storage.saveRoute(payload).then(function(id){
    var base = location.href.split('#')[0].replace(/\?.*$/, '').replace(/[^/]*$/, '');
    var cfgHash = RP.storage.encodeConfigForLink();
    var viewUrl = base + 'view.html?route=' + id + cfgHash;
    var driverUrl = base + 'driver.html?route=' + id + cfgHash;
    document.getElementById('shareBox').innerHTML =
      '<div class="save" style="margin-top:10px">Rota kaydedildi.</div>' +
      '<label class="lbl" style="margin-top:10px">Takip linki (müşteri/ekip)</label>' +
      '<div class="linkbox"><input class="inp" id="viewLink" readonly value="'+esc(viewUrl)+'">' +
      '<button class="ico" data-copy="viewLink" title="Kopyala">' + RP.icons.svg('clipboard') + '</button></div>' +
      '<div class="work-only">' +
      '<label class="lbl" style="margin-top:10px">Şoför linki (konum paylaşır)</label>' +
      '<div class="linkbox"><input class="inp" id="drvLink" readonly value="'+esc(driverUrl)+'">' +
      '<button class="ico" data-copy="drvLink" title="Kopyala">' + RP.icons.svg('clipboard') + '</button></div>' +
      '<p class="hint">Şoför linkini açan kişi konumunu paylaşır; takip linkinde canlı görünür. ' +
      'Linkler Firebase proje bilgisini içerir, karşı tarafın hiçbir kurulum yapması gerekmez.</p>' +
      '<label class="lbl" style="margin-top:12px">Şoföre ata (e-posta)</label>' +
      '<div class="row"><div class="ac">' +
        '<input class="inp" id="assignEmail" type="email" placeholder="surucu@ornek.com" autocomplete="off">' +
      '</div><button class="ico" id="assignBtn" title="Ata">' + RP.icons.svg('send') + '</button></div>' +
      '<p class="hint">Atanan şoför kendi hesabıyla girdiğinde bu rotayı "Rotalarım" altında görür.</p>' +
      '</div>' +
      '<div id="progressBox"></div>';

    document.getElementById('assignBtn').addEventListener('click', function(){
      var email = document.getElementById('assignEmail').value.trim();
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ toast('Geçerli bir e-posta gir', true); return; }
      var b = this;
      b.disabled = true;
      RP.storage.assignDriver(id, email).then(function(){
        toast(email + ' adresine atandı');
      }).catch(function(err){
        toast('Atanamadı: ' + err.message, true);
      }).then(function(){ b.disabled = false; });
    });

    watchDeliveries(id);

    document.getElementById('shareBox').querySelectorAll('[data-copy]').forEach(function(b){
      b.addEventListener('click', function(){
        var inp = document.getElementById(b.dataset.copy);
        inp.select();
        navigator.clipboard.writeText(inp.value).then(function(){ toast('Link kopyalandı'); })
          .catch(function(){ toast('Kopyalanamadı, elle seçip kopyala', true); });
      });
    });

    watchDriver(id);
    loadHistory();
    toast('Rota kaydedildi ve paylaşım linkleri hazır');
  }).catch(function(err){
    console.error(err);
    toast('Kaydedilemedi: ' + err.message, true);
  }).then(function(){
    btn.disabled = false;
    btn.innerHTML = RP.icons.svg('cloud') + 'Kaydet &amp; paylaş';
  });
}

/* Live delivery progress: the planner sees each stop flip to delivered/failed as
   the driver marks it, without reloading. */
var deliveryUnsub = null;
function watchDeliveries(routeId){
  if(deliveryUnsub){ deliveryUnsub(); deliveryUnsub = null; }
  var box = document.getElementById('progressBox');
  if(!box) return;

  deliveryUnsub = RP.storage.subscribeDeliveries(routeId, function(map){
    var steps = [];
    (lastResult ? lastResult.vehicles : []).forEach(function(v, vi){
      v.steps.forEach(function(s, si){
        steps.push(Object.assign({ stopId: 'v' + vi + 's' + si }, s));
      });
    });
    var sum = RP.delivery.summarize(steps, map);
    if(!sum.total) return;

    var rows = steps.filter(function(s){ return s.kind === 'stop'; }).map(function(s){
      var d = map[s.stopId];
      var cls = d ? RP.delivery.statusClass(d.status) : '';
      var icon = !d ? RP.icons.svg('hourglass') :
        (d.status === 'delivered' ? RP.icons.svg('check','ok') : RP.icons.svg('warn','bad'));
      return '<li class="prow ' + cls + '">' + icon +
        '<div><b>Durak ' + (s.stopNo || '') + '</b><small>' + esc(s.label) + '</small>' +
        (d && d.reason ? '<small>' + esc(d.reason) + '</small>' : '') + '</div></li>';
    }).join('');

    box.innerHTML =
      '<label class="lbl" style="margin-top:12px">Teslimat durumu</label>' +
      '<div class="progbar"><span style="width:' + sum.percent + '%"></span></div>' +
      '<p class="hint" style="margin:8px 0 6px">' + sum.delivered + ' teslim · ' +
        sum.failed + ' başarısız · ' + sum.pending + ' bekliyor</p>' +
      '<ul class="plist">' + rows + '</ul>';
  });
}

function watchDriver(routeId){
  if(liveUnsub){ liveUnsub(); liveUnsub = null; }
  layerLive.clearLayers();
  liveMarker = null;
  liveUnsub = RP.storage.subscribeDriverLocation(routeId, function(loc){
    var icon = L.divIcon({ className:'', html:'<div class="truckmk"><svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4h10v8H1z"/><path d="M11 7h3l1.5 2.5V12H11z"/><circle cx="4.5" cy="13" r="1.5"/><circle cx="12" cy="13" r="1.5"/></svg></div>', iconSize:[34,34], iconAnchor:[17,17] });
    if(!liveMarker){
      liveMarker = L.marker([loc.lat, loc.lon], { icon: icon, zIndexOffset: 1000 }).addTo(layerLive);
      toast('Şoför konumu canlı olarak alınıyor');
    } else {
      liveMarker.setLatLng([loc.lat, loc.lon]);
    }
    liveMarker.bindPopup('Şoför · ' + new Date(loc.updatedAt).toLocaleTimeString('tr-TR'));
  });
}

/* ---------- history ---------- */
function loadHistory(){
  var body = document.getElementById('histBody');
  if(!RP.storage.isConfigured()){
    body.innerHTML = '<p class="hint" style="margin:0">Geçmişi görmek için Ayarlar bölümünden Firebase yapılandırmasını ekle.</p>';
    return;
  }
  body.innerHTML = '<p class="hint" style="margin:0"><span class="spin"></span>Yükleniyor…</p>';
  RP.storage.listHistory(15).then(function(list){
    if(!list.length){
      body.innerHTML = '<p class="hint" style="margin:0">Henüz kayıtlı rota yok. Bir rota hesaplayıp “Kaydet & paylaş”a bas.</p>';
      return;
    }
    body.innerHTML = list.map(function(r){
      var stopsN = (r.vehicles||[]).reduce(function(s,v){
        return s + (v.steps||[]).filter(function(p){ return p.kind === 'stop'; }).length;
      }, 0);
      return '<div class="histrow" data-id="'+esc(r.id)+'">' +
        '<div class="badge">'+ (r.vehicles ? r.vehicles.length : 1) +'</div>' +
        '<div style="flex:1">' +
          '<b>' + stopsN + ' durak · ' + fmtKm(r.totalDistance||0) + '</b>' +
          '<small>' + new Date(r.createdAt).toLocaleString('tr-TR') + '</small>' +
        '</div>' +
        '<button class="ico sm" data-open title="Aç">' + RP.icons.svg('open') + '</button>' +
        '<button class="ico sm dgr" data-del title="Sil">' + RP.icons.svg('trash') + '</button>' +
      '</div>';
    }).join('');

    body.querySelectorAll('.histrow').forEach(function(row){
      var id = row.dataset.id;
      row.querySelector('[data-open]').addEventListener('click', function(e){
        e.stopPropagation();
        window.open('view.html?route=' + encodeURIComponent(id), '_blank');
      });
      row.querySelector('[data-del]').addEventListener('click', function(e){
        e.stopPropagation();
        RP.storage.deleteRoute(id).then(function(){ row.remove(); toast('Rota silindi'); })
          .catch(function(err){ toast('Silinemedi: ' + err.message, true); });
      });
      row.addEventListener('click', function(){ restoreRoute(id); });
    });
  }).catch(function(err){
    body.innerHTML = '<p class="hint" style="margin:0">Geçmiş alınamadı: ' + esc(err.message) + '</p>';
  });
}

function restoreRoute(id){
  RP.storage.loadRoute(id).then(function(data){
    clearAllStops();

    if(data.start){
      start = data.start;
      document.getElementById('startInp').value = data.start.label || '';
      document.getElementById('startInp').classList.add('ok');
      placeMarker('start', data.start.lat, data.start.lon, 'st', 'B');
    }
    (data.vehicles||[]).forEach(function(v){
      (v.steps||[]).forEach(function(p){
        if(p.kind !== 'stop') return;
        addStopRow({
          lat: p.lat, lon: p.lon, label: p.label,
          load: p.load, phone: p.phone, windowStart: p.windowStart, windowEnd: p.windowEnd
        });
      });
    });
    /* A custom end point is part of the plan; without restoring it the dropdown
       says "Farklı adreste bitsin" while the field stays hidden and empty, and
       optimising just refuses. */
    if(data.end && data.end.lat != null){
      end = data.end;
      document.getElementById('endInp').value = data.end.label || '';
      document.getElementById('endInp').classList.add('ok');
      placeMarker('end', data.end.lat, data.end.lon, 'en', 'V');
    }

    if(data.options){
      var o = data.options;
      document.getElementById('endMode').value = o.endMode || 'last';
      // setting .value does not fire change, so the end section is synced by hand
      document.getElementById('endSec').hidden = (o.endMode !== 'custom');
      document.getElementById('vehicleCount').value = o.vehicleCount || 1;
      document.getElementById('capacity').value = o.capacity || 0;
      document.getElementById('startTime').value = fmtClock(o.startTime == null ? 540 : o.startTime);
      document.getElementById('shiftHours').value = (o.shiftMinutes || 0) / 60;

      // the metric changes the stop order, so restoring it matters
      var wanted = o.metric === 'duration' ? 'duration' : 'distance';
      document.querySelectorAll('#metric button').forEach(function(b){
        b.classList.toggle('on', b.dataset.m === wanted);
      });
    }
    renumber();
    updateStopCount();
    watchDriver(id);
    toast('Rota yüklendi — yeniden optimize edebilirsin');
  }).catch(function(err){
    toast('Rota yüklenemedi: ' + err.message, true);
  });
}

document.getElementById('histAcc').addEventListener('toggle', function(){
  if(this.open) loadHistory();
});

/* ---------- viewport changes ---------- */
/* Rotating a phone (or the browser's address bar sliding away) changes the map
   container size; without invalidateSize Leaflet keeps the old size and renders
   grey strips. The delay lets the new layout settle before measuring. */
var resizeTimer = null;
function refreshMapSize(){
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function(){ map.invalidateSize(); }, 180);
}
window.addEventListener('resize', refreshMapSize);
window.addEventListener('orientationchange', function(){
  setTimeout(refreshMapSize, 120);
});

/* ---------- PWA ---------- */
if('serviceWorker' in navigator && location.protocol !== 'file:'){
  navigator.serviceWorker.register('sw.js').catch(function(){});
}

})();
