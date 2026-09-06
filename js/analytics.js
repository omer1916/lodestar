window.RP = window.RP || {};

/* Ziyaretçi sayımı (GoatCounter).
   -------------------------------------------------------------------------
   Kendi kopyanı yayınlıyorsan aşağıdaki SITE_CODE'u kendi kodunla değiştir.
   Boş bırakılırsa hiçbir istek gitmez ve hiçbir şey sayılmaz — projeyi klonlayan
   birinin ziyaretçileri kazara bizim hesabımıza yazılmasın diye böyle.

   goatcounter.com üzerinden ücretsiz hesap açılır. Çerez kullanmaz, kişisel veri
   toplamaz; bu yüzden onay bandına da gerek yoktur.
   ------------------------------------------------------------------------- */
(function(){
  "use strict";

  var SITE_CODE = 'omerdastan';   // panel: https://omerdastan.goatcounter.com

  if(!SITE_CODE) return;

  // Do Not Track diyen ziyaretçiyi saymıyoruz; sayı birkaç kişi eksik olsun,
  // tercihine uyulmuş olsun
  if(navigator.doNotTrack === '1' || window.doNotTrack === '1') return;

  /* count.js sayımı pencerenin 'load' olayına bağlar. Script async yüklendiği
     için çoğu zaman load'dan sonra geliyor ve o dinleyici hiç çalışmıyor —
     ziyaret sayılmadan kalıyordu. Otomatik sayımı kapatıp tam bir kez kendimiz
     çağırıyoruz; böylece ne eksik ne çift sayım oluyor. */
  window.goatcounter = window.goatcounter || {};
  window.goatcounter.no_onload = true;

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.setAttribute('data-goatcounter', 'https://' + SITE_CODE + '.goatcounter.com/count');
  s.onload = function(){
    if(window.goatcounter && typeof window.goatcounter.count === 'function'){
      window.goatcounter.count();
    }
  };
  document.head.appendChild(s);
})();
