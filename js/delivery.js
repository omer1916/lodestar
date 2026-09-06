window.RP = window.RP || {};

/* Proof-of-delivery helpers: photo compression and the small vocabulary the
   driver and planner screens share for delivery state. */
RP.delivery = (function(){
  "use strict";

  var MAX_EDGE = 900;      // plenty to read a door number or a signature
  var QUALITY = 0.72;      // ~40-80 KB per photo, far below Firestore's 1 MB doc limit

  /* Reads a File/Blob and returns a downscaled JPEG data URL. Storing the photo
     inline avoids requiring Firebase Storage on top of Firestore. */
  function compressPhoto(file){
    return new Promise(function(resolve, reject){
      var problem = RP.upload.check(file, 'image');
      if(problem) return reject(new Error(problem));

      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function(){
        try {
          // the file can be small while the bitmap behind it is enormous
          if(RP.upload.tooManyPixels(img.width, img.height)){
            URL.revokeObjectURL(url);
            return reject(new Error('Görselin çözünürlüğü çok yüksek, daha küçük bir fotoğraf seç'));
          }
          var scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
          var w = Math.max(1, Math.round(img.width * scale));
          var h = Math.max(1, Math.round(img.height * scale));
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          var data = canvas.toDataURL('image/jpeg', QUALITY);
          URL.revokeObjectURL(url);
          resolve({ dataUrl: data, width: w, height: h, bytes: Math.round(data.length * 0.75) });
        } catch(err){
          URL.revokeObjectURL(url);
          reject(err);
        }
      };
      img.onerror = function(){
        URL.revokeObjectURL(url);
        reject(new Error('Görsel okunamadı'));
      };
      img.src = url;
    });
  }

  var FAIL_REASONS = [
    'Adreste kimse yoktu',
    'Adres bulunamadı',
    'Müşteri teslim almadı',
    'Ürün hasarlı',
    'Ulaşılamadı / yol kapalı',
    'Diğer'
  ];

  function statusLabel(status){
    if(status === 'delivered') return 'Teslim edildi';
    if(status === 'failed') return 'Teslim edilemedi';
    return 'Bekliyor';
  }

  function statusClass(status){
    if(status === 'delivered') return 'ok';
    if(status === 'failed') return 'bad';
    return '';
  }

  /* Counts used by both the driver header and the planner's live progress card. */
  function summarize(stops, deliveries){
    var total = 0, delivered = 0, failed = 0;
    (stops || []).forEach(function(s){
      if(s.kind !== 'stop') return;
      total++;
      var d = deliveries && deliveries[s.stopId];
      if(!d) return;
      if(d.status === 'delivered') delivered++;
      else if(d.status === 'failed') failed++;
    });
    return {
      total: total,
      delivered: delivered,
      failed: failed,
      pending: total - delivered - failed,
      done: delivered + failed,
      percent: total ? Math.round(((delivered + failed) / total) * 100) : 0
    };
  }

  /* Deep links that open the phone's own navigation app. Google Maps handles
     both Android and iOS; Yandex is common for drivers in Turkey. */
  function navLinks(lat, lon, label){
    var q = lat + ',' + lon;
    return {
      google: 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(q) + '&travelmode=driving',
      yandex: 'https://yandex.com.tr/harita/?rtext=~' + encodeURIComponent(q) + '&rtt=auto',
      label: label || q
    };
  }

  /* Pre-filled WhatsApp message so the customer gets an ETA without any SMS cost. */
  function whatsappLink(phone, text){
    var digits = String(phone || '').replace(/[^\d]/g, '');
    if(digits.length < 10) return null;
    if(digits.charAt(0) === '0') digits = '90' + digits.slice(1);
    else if(digits.length === 10) digits = '90' + digits;
    return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(text || '');
  }

  return {
    compressPhoto: compressPhoto,
    FAIL_REASONS: FAIL_REASONS,
    statusLabel: statusLabel,
    statusClass: statusClass,
    summarize: summarize,
    navLinks: navLinks,
    whatsappLink: whatsappLink
  };
})();
