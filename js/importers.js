window.RP = window.RP || {};

/* CSV import. Accepts either a plain one-address-per-line list or a delimited
   file whose header names the columns (adres/yuk/en erken/en gec). */
RP.importers = (function(){
  "use strict";

  var HEADER_ALIASES = {
    address: ['adres','address','durak','nokta','location'],
    load: ['yuk','yük','load','kg','koli','agirlik','ağırlık','miktar'],
    from: ['en erken','erken','baslangic','başlangıç','from','start','saat basla'],
    to: ['en gec','en geç','gec','geç','bitis','bitiş','to','end','son saat'],
    phone: ['telefon','tel','phone','gsm','cep','numara']
  };

  function detectDelimiter(line){
    var counts = [[';', (line.match(/;/g)||[]).length],
                  ['\t', (line.match(/\t/g)||[]).length],
                  [',', (line.match(/,/g)||[]).length]];
    counts.sort(function(a,b){ return b[1]-a[1]; });
    return counts[0][1] > 0 ? counts[0][0] : null;
  }

  function splitLine(line, delim){
    if(!delim) return [line];
    var out = [], cur = '', inQ = false;
    for(var i=0;i<line.length;i++){
      var ch = line[i];
      if(ch === '"'){
        if(inQ && line[i+1] === '"'){ cur += '"'; i++; }
        else inQ = !inQ;
      } else if(ch === delim && !inQ){ out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(function(s){ return s.trim(); });
  }

  function normalize(s){
    return String(s||'').toLowerCase().trim()
      .replace(/ı/g,'i').replace(/ş/g,'s').replace(/ğ/g,'g')
      .replace(/ü/g,'u').replace(/ö/g,'o').replace(/ç/g,'c');
  }

  function findColumn(headers, aliases){
    for(var i=0;i<headers.length;i++){
      var h = normalize(headers[i]);
      for(var j=0;j<aliases.length;j++){
        if(h === normalize(aliases[j]) || h.indexOf(normalize(aliases[j])) === 0) return i;
      }
    }
    return -1;
  }

  function parseTime(v){
    var m = String(v||'').trim().match(/^(\d{1,2})[:.](\d{2})$/);
    if(!m) return null;
    var h = parseInt(m[1],10), mi = parseInt(m[2],10);
    if(h > 23 || mi > 59) return null;
    return h*60 + mi;
  }

  function looksLikeHeader(cells, delim){
    var known = 0;
    for(var key in HEADER_ALIASES){
      if(findColumn(cells, HEADER_ALIASES[key]) >= 0) known++;
    }
    var plain = cells.every(function(c){
      var v = String(c || '').trim();
      return v.length <= 24 && !/\d/.test(v);
    });
    // a lone "adres" column is a believable header only when it is the whole row
    return plain && (known >= 2 || cells.length === 1);
  }

  function parse(text){
    var lines = String(text||'').split(/\r?\n/).map(function(l){ return l.trim(); })
      .filter(function(l){ return l.length > 0; });
    if(!lines.length) return [];

    var delim = detectDelimiter(lines[0]);
    var firstCells = splitLine(lines[0], delim);
    var addrCol = findColumn(firstCells, HEADER_ALIASES.address);

    /* Header aliases ("adres", "durak", "nokta") are ordinary Turkish street
       words, so a first data row such as "Adresler Sokak No 5, Ankara" used to
       be swallowed as a header — deleting that delivery AND truncating every
       other address at the first comma. A header row must therefore look like a
       header: short cells, no digits, and either a second recognised column or
       a single-column file. */
    var hasHeader = addrCol >= 0 && looksLikeHeader(firstCells, delim);

    var loadCol = -1, fromCol = -1, toCol = -1, phoneCol = -1;
    if(hasHeader){
      loadCol = findColumn(firstCells, HEADER_ALIASES.load);
      fromCol = findColumn(firstCells, HEADER_ALIASES.from);
      toCol = findColumn(firstCells, HEADER_ALIASES.to);
      phoneCol = findColumn(firstCells, HEADER_ALIASES.phone);
    }

    var rows = hasHeader ? lines.slice(1) : lines;
    return rows.map(function(line){
      var cells = splitLine(line, delim);
      var address = hasHeader ? (cells[addrCol]||'') : cells.join(delim === ',' ? ', ' : ' ').trim();
      // a single-column file without a header is just the address itself
      if(!hasHeader && cells.length > 1 && delim === ',') address = line.trim();
      var load = loadCol >= 0 ? (parseFloat(String(cells[loadCol]).replace(',','.')) || 0) : 0;
      return {
        address: address,
        load: load > 0 ? load : 0,   // negative loads would corrupt capacity packing
        windowStart: fromCol >= 0 ? parseTime(cells[fromCol]) : null,
        windowEnd: toCol >= 0 ? parseTime(cells[toCol]) : null,
        phone: phoneCol >= 0 ? String(cells[phoneCol] || '').trim() : ''
      };
    }).filter(function(r){
      if(!r.address || r.address.length < 3) return false;
      // a bare "41.0082,28.9784" row is a legitimate stop, not noise
      if(RP.geo && RP.geo.parseLatLon && RP.geo.parseLatLon(r.address)) return true;
      // otherwise an address needs some letters — punctuation/digit rows are noise
      return /[a-zA-ZğüşöçıİĞÜŞÖÇ]{2}/.test(r.address);
    });
  }

  return { parse: parse, parseTime: parseTime };
})();
