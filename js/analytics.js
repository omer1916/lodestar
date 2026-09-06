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

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.setAttribute('data-goatcounter', 'https://' + SITE_CODE + '.goatcounter.com/count');
  document.head.appendChild(s);
})();
