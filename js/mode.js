window.RP = window.RP || {};

/* Usage mode. 'work' is the courier / haulier planner with fleet, capacity, shift
   and delivery controls; 'personal' is a driver planning their own trip and hides
   all of that. Hiding is done with CSS, so readOptions() must ALSO ignore the
   hidden inputs — a vehicle count left over from work mode would otherwise still
   split the route even though the field is invisible. */
RP.mode = (function(){
  "use strict";

  var KEY = 'rp_mode';
  var listeners = [];

  function stored(){
    // storage throws in private mode on some browsers, and may hold anything
    try {
      var v = localStorage.getItem(KEY);
      return (v === 'work' || v === 'personal') ? v : null;
    } catch(e){ return null; }
  }

  var current = stored();

  function apply(){
    document.documentElement.setAttribute('data-mode', current || 'work');
  }

  apply();

  return {
    // null means the visitor has not chosen yet — the first-run prompt should run
    get: function(){ return current; },
    isPersonal: function(){ return current === 'personal'; },

    set: function(m){
      if(m !== 'work' && m !== 'personal') return;
      var changed = current !== m;
      current = m;
      try { localStorage.setItem(KEY, m); } catch(e){}
      apply();
      if(changed) listeners.forEach(function(fn){ try { fn(m); } catch(e){} });
    },

    onChange: function(fn){ listeners.push(fn); },
    apply: apply
  };
})();
