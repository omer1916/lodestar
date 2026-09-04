window.RP = window.RP || {};

/* Inline stroke icons used instead of emoji: they inherit the current text
   colour, stay crisp at any zoom and render identically on every platform
   (emoji glyphs differ wildly between Windows, Android and iOS). */
RP.icons = (function(){
  "use strict";

  var PATHS = {
    truck:    '<path d="M1 4h10v8H1z"/><path d="M11 7h3l1.5 2.5V12H11z"/><circle cx="4.5" cy="13" r="1.5"/><circle cx="12" cy="13" r="1.5"/>',
    moon:     '<path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z"/>',
    sun:      '<circle cx="8" cy="8" r="3.2"/><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1"/>',
    target:   '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="1.8"/><path d="M8 .8v2M8 13.2v2M.8 8h2M13.2 8h2"/>',
    pin:      '<path d="M8 14.5s5-4.7 5-8a5 5 0 0 0-10 0c0 3.3 5 8 5 8z"/><circle cx="8" cy="6.4" r="1.9"/>',
    save:     '<path d="M2.5 2.5h8L13.5 5.5v8h-11z"/><path d="M5 2.5v4h5v-4"/><path d="M5 13.5v-4h6v4"/>',
    send:     '<path d="M14.5 8 2 2.5l2 5.5-2 5.5z"/><path d="M4 8h10"/>',
    star:     '<path d="M8 1.8 10 6l4.4.6-3.2 3.1.8 4.4L8 12l-4 2.1.8-4.4L1.6 6.6 6 6z"/>',
    file:     '<path d="M9 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.5z"/><path d="M9 1.5v4h4"/><path d="M5.5 8.5h5M5.5 11h5"/>',
    camera:   '<path d="M1.5 5h3l1-1.7h5L11.5 5h3v8.5h-13z"/><circle cx="8" cy="8.9" r="2.8"/>',
    barcode:  '<path d="M1.5 2.5v11M4 2.5v11M6.5 2.5v7M9 2.5v11M11.5 2.5v7M14 2.5v11"/>',
    printer:  '<path d="M4 6V2h8v4"/><path d="M2 6h12v5h-2.5"/><path d="M4.5 11H2"/><path d="M4 10h8v4.5H4z"/>',
    cloud:    '<path d="M4.4 12.5A3.4 3.4 0 0 1 4.8 5.8a4.4 4.4 0 0 1 8.3 1.6 2.8 2.8 0 0 1-.6 5.1z"/>',
    clipboard:'<path d="M5.5 3H4a1 1 0 0 0-1 1v9.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-1.5"/><path d="M5.5 1.8h5v2.4h-5z"/>',
    book:     '<path d="M2.5 2.5h5a2 2 0 0 1 2 2v9a1.6 1.6 0 0 0-1.6-1.6H2.5z"/><path d="M13.5 2.5h-4"/><path d="M13.5 2.5v9.4h-3.4A1.6 1.6 0 0 0 8.5 13.5"/>',
    gear:     '<circle cx="8" cy="8" r="2.4"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4"/>',
    key:      '<circle cx="5" cy="8" r="3"/><path d="M8 8h6.5"/><path d="M12 8v2.5M14 8v2"/>',
    chart:    '<path d="M2 14V2"/><path d="M2 14h12"/><path d="M5 11.5V8M8 11.5V4.5M11 11.5V6.5"/>',
    power:    '<path d="M8 1.8v6"/><path d="M11.7 4a5.5 5.5 0 1 1-7.4 0"/>',
    check:    '<path d="M2.5 8.5 6 12l7.5-8"/>',
    warn:     '<path d="M8 1.8 15 13.8H1z"/><path d="M8 6v3.6M8 11.6v.1"/>',
    clock:    '<circle cx="8" cy="8" r="6.2"/><path d="M8 4.4V8l2.6 1.6"/>',
    box:      '<path d="M8 1.6 14 5v6l-6 3.4L2 11V5z"/><path d="M2 5l6 3.4L14 5"/><path d="M8 8.4v6"/>',
    traffic:  '<rect x="4.5" y="1.5" width="7" height="13" rx="2"/><circle cx="8" cy="5" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="8" cy="11" r="1.2"/>',
    fuel:     '<path d="M2.5 14V3a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 8.5 3v11"/><path d="M1.5 14h8"/><path d="M2.5 7h6"/><path d="M8.5 5.5h2.2A1.3 1.3 0 0 1 12 6.8V11a1.2 1.2 0 0 0 2.4 0V6l-1.6-1.8"/>',
    trend:    '<path d="M2 4l4.5 4.5L9 6l5 5"/><path d="M14 7.5V11h-3.5"/>',
    map:      '<path d="M1.8 3.6 6 2v10.4l-4.2 1.6z"/><path d="M6 2l4 1.6v10.4L6 12.4z"/><path d="M10 3.6l4.2-1.6v10.4L10 14z"/>',
    compass:  '<circle cx="8" cy="8" r="6.2"/><path d="M10.6 5.4 9.2 9.2 5.4 10.6 6.8 6.8z"/>',
    chat:     '<path d="M14 9.5a2 2 0 0 1-2 2H5.5L2 14.5V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/>',
    phone:    '<rect x="4" y="1.5" width="8" height="13" rx="1.6"/><path d="M7 12.4h2"/>',
    edit:     '<path d="M11 2.2 13.8 5 5.5 13.3l-3.3.5.5-3.3z"/><path d="M9.6 3.6 12.4 6.4"/>',
    stop:     '<rect x="3" y="3" width="10" height="10" rx="1.6"/>',
    hourglass:'<path d="M4 1.8h8M4 14.2h8"/><path d="M4.8 1.8v3L8 8l3.2-3.2v-3"/><path d="M4.8 14.2v-3L8 8l3.2 3.2v3"/>',
    plus:     '<path d="M8 3v10M3 8h10"/>',
    trash:    '<path d="M2.5 4.5h11"/><path d="M6.5 4.5V2.8h3v1.7"/><path d="M4 4.5l.7 9h6.6l.7-9"/>',
    close:    '<path d="M4 4l8 8M12 4l-8 8"/>',
    open:     '<path d="M9 2.5h4.5V7"/><path d="M13.5 2.5 7.5 8.5"/><path d="M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"/>',
    dots:     '<circle cx="3.5" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="12.5" cy="8" r="1.2"/>'
  };

  /* `extra` lets a caller add a class, e.g. for a colour accent. */
  function svg(name, extra){
    var body = PATHS[name];
    if(!body) return '';
    return '<svg class="ic ' + (extra || '') + '" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
           body + '</svg>';
  }

  return { svg: svg, names: Object.keys(PATHS) };
})();
