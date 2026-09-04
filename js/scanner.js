window.RP = window.RP || {};

/* Barcode / QR scanning for adding a stop from a package label.
   Uses the browser's native BarcodeDetector where available (Chrome on Android,
   which is what drivers actually use) and falls back to jsQR for QR codes. */
RP.scanner = (function(){
  "use strict";

  var JSQR_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.js';
  var jsqrLoading = null;

  function nativeAvailable(){
    return typeof window.BarcodeDetector === 'function';
  }

  function loadJsQR(){
    if(window.jsQR) return Promise.resolve(window.jsQR);
    if(jsqrLoading) return jsqrLoading;
    jsqrLoading = new Promise(function(resolve, reject){
      var s = document.createElement('script');
      s.src = JSQR_URL;
      s.onload = function(){ resolve(window.jsQR); };
      s.onerror = function(){ reject(new Error('Barkod kütüphanesi yüklenemedi')); };
      document.head.appendChild(s);
    });
    return jsqrLoading;
  }

  /* Opens the rear camera and resolves with the first code it reads.
     `hostEl` receives the video preview; call the returned stop() to cancel. */
  function scan(hostEl, onResult, onError){
    var stream = null, raf = null, stopped = false, detector = null;

    var video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.muted = true;

    var wrap = document.createElement('div');
    wrap.className = 'scanwrap';
    wrap.appendChild(video);
    var frame = document.createElement('div');
    frame.className = 'scanframe';
    wrap.appendChild(frame);
    hostEl.innerHTML = '';
    hostEl.appendChild(wrap);

    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d', { willReadFrequently: true });

    function finish(text){
      if(stopped) return;
      stop();
      onResult(text);
    }

    function stop(){
      stopped = true;
      if(raf) cancelAnimationFrame(raf);
      if(stream) stream.getTracks().forEach(function(t){ t.stop(); });
      hostEl.innerHTML = '';
    }

    function tick(){
      if(stopped) return;
      if(video.readyState === video.HAVE_ENOUGH_DATA){
        if(detector){
          detector.detect(video).then(function(codes){
            if(codes && codes.length) finish(codes[0].rawValue);
          }).catch(function(){ /* a failed frame is not fatal */ });
        } else if(window.jsQR){
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          var code = window.jsQR(img.data, img.width, img.height);
          if(code && code.data) finish(code.data);
        }
      }
      raf = requestAnimationFrame(tick);
    }

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(function(s){
        if(stopped){ s.getTracks().forEach(function(t){ t.stop(); }); return; }
        stream = s;
        video.srcObject = s;
        return video.play();
      })
      .then(function(){
        if(stopped) return;
        if(nativeAvailable()){
          detector = new window.BarcodeDetector({
            formats: ['qr_code','code_128','code_39','ean_13','ean_8','itf','codabar','upc_a','upc_e']
          });
          tick();
          return;
        }
        return loadJsQR().then(function(){ tick(); });
      })
      .catch(function(err){
        stop();
        onError(err);
      });

    return stop;
  }

  /* Package labels often carry a URL or "key: value" text rather than a bare
     address, so pull out whatever looks usable. */
  function textFromCode(raw){
    var text = String(raw || '').trim();
    if(!text) return null;

    /* Every coordinate branch goes through the same range check — a code reading
       "geo:200,400" used to place a stop 17.000 km away without complaint. */
    function coords(lat, lon){
      var la = parseFloat(lat), lo = parseFloat(lon);
      if(!isFinite(la) || !isFinite(lo)) return null;
      if(Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
      return { coords: { lat: la, lon: lo } };
    }

    var geo = text.match(/^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
    if(geo){ var g = coords(geo[1], geo[2]); if(g) return g; }

    var pair = text.match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if(pair){ var p = coords(pair[1], pair[2]); if(p) return p; }

    /* Map links carry @lat,lon or ?q=lat,lon. The old pattern was a character
       CLASS — it matched any single '@', '?', 'q' or '=', so an ordinary
       tracking URL like "…/p?ref=12.5,3.75" was read as a coordinate. */
    var atCoords = text.match(/(?:@|[?&]q=)(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/);
    if(atCoords){ var a = coords(atCoords[1], atCoords[2]); if(a) return a; }

    return { query: text };
  }

  return {
    nativeAvailable: nativeAvailable,
    scan: scan,
    textFromCode: textFromCode
  };
})();
