window.RP = window.RP || {};

/* Sign-in / sign-up modal and the header session chip. The markup is injected
   from here so the landing page, the planner and the driver screen share one
   copy instead of each carrying its own. */
RP.authUI = (function(){
  "use strict";

  var modal = null;
  var mode = 'login';        // 'login' | 'register' | 'reset'
  var afterAuth = null;      // callback to run once sign-in succeeds

  function el(id){ return modal ? modal.querySelector('[data-el="'+id+'"]') : null; }

  function mount(){
    if(modal) return modal;
    modal = document.createElement('div');
    modal.className = 'modal';
    modal.hidden = true;
    modal.innerHTML =
      '<div class="modal-back" data-el="back"></div>' +
      '<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="authTitle">' +
        '<button class="modal-x" data-el="close" aria-label="Kapat">' + RP.icons.svg('close') + '</button>' +
        '<h2 id="authTitle" data-el="title">Giriş yap</h2>' +
        '<p class="modal-sub" data-el="sub">Rotalarını kaydet, şoförüne ata ve teslimatları takip et.</p>' +

        '<button class="btn gbtn" data-el="google">' +
          '<span class="gicon" aria-hidden="true">G</span> Google ile devam et' +
        '</button>' +

        '<div class="divider" data-el="divider"><span>veya</span></div>' +

        '<form data-el="form" novalidate>' +
          '<div class="field" data-el="nameField" hidden>' +
            '<label class="lbl">Ad soyad</label>' +
            '<input class="inp" data-el="name" type="text" autocomplete="name" placeholder="Adın">' +
          '</div>' +
          '<div class="field">' +
            '<label class="lbl">E-posta</label>' +
            '<input class="inp" data-el="email" type="email" autocomplete="email" placeholder="ornek@eposta.com" required>' +
          '</div>' +
          '<div class="field" data-el="passField">' +
            '<label class="lbl">Şifre</label>' +
            '<input class="inp" data-el="password" type="password" autocomplete="current-password" placeholder="En az 6 karakter" required>' +
          '</div>' +
          '<div class="field" data-el="roleField" hidden>' +
            '<label class="lbl">Hesap türü</label>' +
            '<div class="seg wide" data-el="role">' +
              '<button type="button" data-r="planner" class="on">Planlayıcı</button>' +
              '<button type="button" data-r="driver">Şoför</button>' +
            '</div>' +
            '<p class="hint" data-el="roleHint">Planlayıcı rota oluşturur ve şoföre atar.</p>' +
          '</div>' +

          '<div class="authmsg" data-el="msg" hidden></div>' +

          '<button class="btn primary" data-el="submit" type="submit">Giriş yap</button>' +
        '</form>' +

        '<div class="modal-foot">' +
          '<button class="linkbtn" data-el="forgot">Şifremi unuttum</button>' +
          '<button class="linkbtn" data-el="swap">Hesabın yok mu? Kayıt ol</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    wire();
    return modal;
  }

  function wire(){
    el('back').addEventListener('click', close);
    el('close').addEventListener('click', close);
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && modal && !modal.hidden) close();
    });

    el('role').addEventListener('click', function(e){
      var b = e.target.closest('button[data-r]');
      if(!b) return;
      this.querySelectorAll('button').forEach(function(x){ x.classList.remove('on'); });
      b.classList.add('on');
      el('roleHint').textContent = b.dataset.r === 'driver'
        ? 'Şoför, kendisine atanan rotaları görür ve teslimatları işaretler.'
        : 'Planlayıcı rota oluşturur ve şoföre atar.';
    });

    el('swap').addEventListener('click', function(){
      setMode(mode === 'login' ? 'register' : 'login');
    });
    el('forgot').addEventListener('click', function(){
      setMode(mode === 'reset' ? 'login' : 'reset');
    });

    el('google').addEventListener('click', function(){
      run(el('google'), RP.auth.signInGoogle());
    });

    el('form').addEventListener('submit', function(e){
      e.preventDefault();
      submit();
    });
  }

  /* Only offer a provider the project actually has enabled. */
  function googleEnabled(){
    var p = window.RP && RP.authProviders;
    return !p || p.google !== false;
  }

  function setMode(next){
    mode = next;
    var isRegister = mode === 'register';
    var isReset = mode === 'reset';
    var showGoogle = googleEnabled() && !isReset;

    el('title').textContent = isReset ? 'Şifre sıfırla' : (isRegister ? 'Hesap oluştur' : 'Giriş yap');
    el('sub').textContent = isReset
      ? 'E-posta adresine sıfırlama bağlantısı gönderelim.'
      : 'Rotalarını kaydet, şoförüne ata ve teslimatları takip et.';
    el('nameField').hidden = !isRegister;
    el('roleField').hidden = !isRegister;
    el('passField').hidden = isReset;
    el('google').hidden = !showGoogle;
    el('divider').hidden = !showGoogle;
    el('forgot').hidden = isRegister;
    el('submit').textContent = isReset ? 'Sıfırlama bağlantısı gönder' : (isRegister ? 'Hesap oluştur' : 'Giriş yap');
    el('swap').textContent = isRegister ? 'Zaten hesabın var mı? Giriş yap' : 'Hesabın yok mu? Kayıt ol';
    el('password').setAttribute('autocomplete', isRegister ? 'new-password' : 'current-password');
    message('');
  }

  function message(text, kind){
    var m = el('msg');
    m.textContent = text || '';
    m.hidden = !text;
    m.className = 'authmsg' + (kind ? ' ' + kind : '');
  }

  function busy(btn, on, label){
    btn.disabled = on;
    if(on){
      btn.dataset.label = btn.innerHTML;
      btn.innerHTML = '<span class="spin"></span>' + (label || 'Bekle…');
    } else if(btn.dataset.label){
      btn.innerHTML = btn.dataset.label;
      delete btn.dataset.label;
    }
  }

  function run(btn, promise, successText){
    message('');
    busy(btn, true);
    return promise.then(function(res){
      busy(btn, false);
      if(successText){ message(successText, 'ok'); return res; }
      close();
      if(afterAuth){ var cb = afterAuth; afterAuth = null; cb(); }
      return res;
    }).catch(function(err){
      busy(btn, false);
      message(RP.auth.friendlyError(err), 'err');
      throw err;
    }).catch(function(){ /* already surfaced in the modal */ });
  }

  function submit(){
    var email = el('email').value.trim();
    var pass = el('password').value;
    var name = el('name').value.trim();
    var btn = el('submit');

    if(!email){ message('E-posta gerekli.', 'err'); return; }

    if(mode === 'reset'){
      run(btn, RP.auth.resetPassword(email), 'Sıfırlama bağlantısı gönderildi — e-postanı kontrol et.');
      return;
    }
    if(pass.length < 6){ message('Şifre en az 6 karakter olmalı.', 'err'); return; }

    if(mode === 'register'){
      if(!name){ message('Ad soyad gerekli.', 'err'); return; }
      var role = el('role').querySelector('button.on').dataset.r;
      run(btn, RP.auth.signUpEmail(name, email, pass, role));
    } else {
      run(btn, RP.auth.signInEmail(email, pass));
    }
  }

  function open(startMode, onDone){
    if(!RP.auth.available()){
      if(window.RP && RP.authUI.onUnavailable) RP.authUI.onUnavailable();
      return false;
    }
    mount();
    afterAuth = onDone || null;
    setMode(startMode || 'login');
    modal.hidden = false;
    setTimeout(function(){
      var first = el(mode === 'register' ? 'name' : 'email');
      if(first) first.focus();
    }, 60);
    return true;
  }

  function close(){
    if(modal) modal.hidden = true;
    message('');
  }

  /* Renders either a "Giriş yap" button or the signed-in chip into `host`. */
  function mountHeader(host, opts){
    opts = opts || {};
    if(!host) return;

    function render(user, profile){
      host.innerHTML = '';
      if(!RP.auth.available()){
        if(opts.hideWhenUnavailable) return;
        var note = document.createElement('button');
        note.className = 'btn ghost sm';
        note.innerHTML = RP.icons.svg('key') + 'Giriş';
        note.title = 'Giriş için önce Ayarlar bölümünden Firebase yapılandırması gerekiyor';
        note.addEventListener('click', function(){
          if(opts.onUnavailable) opts.onUnavailable();
        });
        host.appendChild(note);
        return;
      }

      if(!user){
        var b = document.createElement('button');
        b.className = 'btn ghost sm';
        b.textContent = 'Giriş yap';
        b.addEventListener('click', function(){ open('login', opts.onSignedIn); });
        host.appendChild(b);
        return;
      }

      var name = (profile && profile.name) || user.displayName || user.email || 'Hesabım';
      var role = profile && profile.role === 'driver' ? 'Şoför' : 'Planlayıcı';
      var chip = document.createElement('div');
      chip.className = 'userchip';
      chip.innerHTML =
        '<div class="avatar">' + escapeHtml(name.trim().charAt(0).toUpperCase() || '?') + '</div>' +
        '<div class="uinfo"><b>' + escapeHtml(name) + '</b><small>' + role + '</small></div>' +
        '<button class="ico sm" data-out title="Çıkış yap">' + RP.icons.svg('power') + '</button>';
      chip.querySelector('[data-out]').addEventListener('click', function(){
        RP.auth.signOut().then(function(){
          if(opts.onSignedOut) opts.onSignedOut();
        });
      });
      host.appendChild(chip);
    }

    RP.auth.onChange(render);
    render(RP.auth.user(), RP.auth.profile());
  }

  function escapeHtml(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  return {
    mount: mount,
    open: open,
    close: close,
    mountHeader: mountHeader
  };
})();
