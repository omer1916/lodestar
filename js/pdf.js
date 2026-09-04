window.RP = window.RP || {};

/* Printable delivery manifest. Uses the browser's own print pipeline (and its
   "Save as PDF"), so there is no extra dependency to ship or keep updated. */
RP.pdf = (function(){
  "use strict";

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function fmtClock(min){
    if(min == null) return '';
    var h = Math.floor(min/60) % 24, m = Math.round(min%60);
    return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
  }

  function windowText(from, to){
    if(from != null && to != null) return fmtClock(from) + '-' + fmtClock(to);
    if(to != null) return fmtClock(to) + '\'e kadar';
    if(from != null) return fmtClock(from) + '\'den sonra';
    return '';
  }

  function build(result, meta){
    var el = document.getElementById('printArea');
    if(!el) return;

    var html = '<h1>Teslimat Listesi</h1>' +
      '<div class="meta">' + esc(meta.date) + ' · Çıkış ' + esc(meta.startTime) +
      ' · ' + result.vehicles.length + ' araç · ' +
      esc(meta.totalDistance) + ' · ' + esc(meta.totalDuration) + '</div>';

    result.vehicles.forEach(function(v, vi){
      html += '<div class="vh">Araç ' + (vi+1) +
        ' — ' + esc(v.distanceText) + ' / ' + esc(v.durationText) +
        (v.load ? ' · yük: ' + esc(v.load) : '') + '</div>';
      html += '<table><thead><tr>' +
        '<th style="width:34px">#</th><th>Adres</th>' +
        '<th style="width:70px">Varış</th><th style="width:60px">Yük</th>' +
        '<th style="width:90px">Zaman aralığı</th><th style="width:80px">İmza</th>' +
        '</tr></thead><tbody>';
      v.steps.forEach(function(s, i){
        var win = windowText(s.windowStart, s.windowEnd);
        html += '<tr>' +
          '<td>' + (s.kind === 'stop' ? (s.stopNo) : (s.kind === 'start' ? 'B' : 'V')) + '</td>' +
          '<td>' + esc(s.label) + '</td>' +
          '<td>' + esc(fmtClock(s.eta)) + (s.late ? ' ' : '') + '</td>' +
          '<td>' + (s.load ? esc(s.load) : '') + '</td>' +
          '<td>' + esc(win) + '</td>' +
          '<td></td>' +
          '</tr>';
      });
      html += '</tbody></table>';
    });

    html += '<div class="sign">Teslim alan / Şoför imzası: ______________________</div>';
    el.innerHTML = html;
  }

  function print(result, meta){
    build(result, meta);
    window.print();
  }

  return { build: build, print: print, fmtClock: fmtClock, windowText: windowText };
})();
