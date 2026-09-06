window.RP = window.RP || {};

/* One place for the limits on anything a person hands the app.
   The accept="" attribute on a file input is a convenience for the file picker,
   not a control: it is bypassed by choosing "All files" or by drag-and-drop, so
   every upload path re-checks type and size here.

   Nothing uploaded is ever executed or served back: images are re-encoded through
   a canvas (which discards everything that is not pixels, including any payload
   appended to the file) and text files are parsed as data. What is left to defend
   against is resource exhaustion — a huge file that freezes the tab, or a small
   file that decodes into an enormous bitmap. */
RP.upload = (function(){
  "use strict";

  var LIMITS = {
    image: 8 * 1024 * 1024,   // a phone photo is 2-5 MB
    text:  2 * 1024 * 1024    // 2 MB of addresses is already tens of thousands of rows
  };

  /* A few hundred KB of PNG can decode to 20000x20000 pixels, which is ~1.6 GB
     once the browser has it in a canvas. Size alone does not catch that. */
  var MAX_PIXELS = 40e6;

  function fmtSize(bytes){
    return bytes >= 1048576 ? Math.round(bytes / 1048576) + ' MB'
                            : Math.round(bytes / 1024) + ' KB';
  }

  /* Returns null when the file may be processed, otherwise the message to show. */
  function check(file, kind){
    if(!file) return 'Dosya seçilmedi.';
    if(file.size === 0) return 'Dosya boş görünüyor.';

    var max = LIMITS[kind] || LIMITS.text;
    if(file.size > max){
      return 'Dosya çok büyük (' + fmtSize(file.size) + '). En fazla ' + fmtSize(max) + ' olabilir.';
    }

    if(kind === 'image'){
      if(!/^image\//.test(file.type || '')) return 'Bu bir görsel değil.';
      return null;
    }

    // browsers report CSV inconsistently (often as an Excel type, sometimes as
    // nothing at all), so the extension is accepted as a second opinion
    var type = file.type || '';
    var name = (file.name || '').toLowerCase();
    var typeOk = type === '' || /^text\//.test(type) ||
                 type === 'text/csv' || type === 'application/vnd.ms-excel';
    if(!typeOk && !/\.(csv|txt)$/.test(name)){
      return 'Yalnızca CSV veya metin dosyası yükleyebilirsin.';
    }
    return null;
  }

  /* Guards the decoded bitmap, which the file size cannot predict. */
  function tooManyPixels(width, height){
    return (width * height) > MAX_PIXELS;
  }

  return {
    check: check,
    tooManyPixels: tooManyPixels,
    LIMITS: LIMITS,
    MAX_PIXELS: MAX_PIXELS
  };
})();
