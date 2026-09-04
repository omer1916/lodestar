window.RP = window.RP || {};

/* Photo -> address list, using Tesseract.js entirely in the browser.
   OCR output is never trusted directly: lines are cleaned and handed back for
   the user to review and edit before anything gets geocoded. */
RP.ocr = (function(){
  "use strict";

  var TESSERACT_URL = 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.0/tesseract.min.js';
  var loading = null;

  function loadTesseract(){
    if(typeof Tesseract !== 'undefined') return Promise.resolve();
    if(loading) return loading;
    loading = new Promise(function(resolve, reject){
      var s = document.createElement('script');
      s.src = TESSERACT_URL;
      s.onload = function(){ resolve(); };
      s.onerror = function(){ reject(new Error('Tesseract.js yüklenemedi (internet bağlantısını kontrol et)')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  function cleanLines(text){
    return String(text||'')
      .split(/\r?\n/)
      .map(function(l){
        return l
          .replace(/^[\s\-–—•*·.,:;|>»]+/, '')
          .replace(/[\s|]+$/, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
      })
      .filter(function(l){
        if(l.length < 6) return false;                    // too short to be an address
        if(!/[a-zA-ZğüşöçıİĞÜŞÖÇ]/.test(l)) return false;  // digits/noise only
        var letters = (l.match(/[a-zA-ZğüşöçıİĞÜŞÖÇ]/g)||[]).length;
        return letters / l.length > 0.4;                  // mostly garbage characters
      });
  }

  function recognize(file, onProgress){
    return loadTesseract().then(function(){
      return Tesseract.recognize(file, 'tur+eng', {
        logger: function(m){
          if(onProgress && m.status === 'recognizing text') onProgress(Math.round((m.progress||0)*100));
        }
      });
    }).then(function(res){
      return cleanLines(res && res.data ? res.data.text : '');
    });
  }

  return { recognize: recognize, cleanLines: cleanLines };
})();
