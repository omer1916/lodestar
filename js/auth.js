window.RP = window.RP || {};

/* Firebase Auth wrapper: Google popup + email/password, plus the users/{uid}
   profile document that carries the name and the planner/driver role.

   Signing in is always optional. Without it — or without a Firebase config at
   all — the planner keeps working; an account only unlocks history, sharing,
   driver assignment and delivery tracking. */
RP.auth = (function(){
  "use strict";

  var currentUser = null;
  var profile = null;
  var listeners = [];
  var started = false;
  var resolvedOnce = null;
  /* Held between "create the account" and "write the profile": the auth-state
     listener fires in between and would otherwise store a default profile built
     from the e-mail address instead of the name and role just chosen. */
  var pendingSignup = null;

  function available(){
    return RP.storage.isConfigured() && typeof firebase !== 'undefined';
  }

  /* Anonymous sessions are created by storage.init() so guests can still save a
     route; they are not "signed in" as far as the UI is concerned. */
  function isSignedIn(){
    return !!(currentUser && !currentUser.isAnonymous);
  }

  function user(){ return isSignedIn() ? currentUser : null; }
  function profileData(){ return isSignedIn() ? profile : null; }

  function notify(){
    var u = user(), p = profileData();
    listeners.forEach(function(cb){
      try { cb(u, p); } catch(e){ console.error(e); }
    });
  }

  /* Fires immediately with the current state, then on every change. */
  function onChange(cb){
    listeners.push(cb);
    if(resolvedOnce) cb(user(), profileData());
    return function(){
      var i = listeners.indexOf(cb);
      if(i >= 0) listeners.splice(i, 1);
    };
  }

  function start(){
    if(started || !available()) return Promise.resolve(null);
    started = true;
    return RP.storage.init().then(function(){
      return new Promise(function(resolve){
        firebase.auth().onAuthStateChanged(function(u){
          currentUser = u;
          resolvedOnce = true;
          /* Announce the session immediately. The profile document lives in
             Firestore, which may be slow or not set up yet — waiting for it
             would leave a signed-in user stuck behind the sign-in gate. */
          notify();
          if(u && !u.isAnonymous){
            loadProfile(u).then(function(){
              notify();
              resolve(user());
            });
          } else {
            profile = null;
            notify();
            resolve(null);
          }
        });
      });
    }).catch(function(err){
      console.warn('Auth başlatılamadı:', err.message);
      resolvedOnce = true;
      notify();
      return null;
    });
  }

  function profileRef(uid){
    return firebase.firestore().collection('users').doc(uid);
  }

  /* Firestore can hang when the database has not been created yet, so the read
     is raced against a timeout and the UI carries on without a profile. */
  function withTimeout(promise, ms){
    return new Promise(function(resolve, reject){
      var done = false;
      var t = setTimeout(function(){
        if(done) return;
        done = true;
        reject(new Error('Firestore yanıt vermedi (veritabanı oluşturulmuş mu?)'));
      }, ms);
      promise.then(function(v){
        if(done) return;
        done = true; clearTimeout(t); resolve(v);
      }, function(e){
        if(done) return;
        done = true; clearTimeout(t); reject(e);
      });
    });
  }

  function loadProfile(u){
    return withTimeout(profileRef(u.uid).get(), 8000).then(function(snap){
      profile = snap.exists ? snap.data() : null;
      if(!profile) return createProfile(u, pendingSignup || {});
      return profile;
    }).catch(function(err){
      console.warn('Profil okunamadı:', err.message);
      profile = null;
      return null;
    });
  }

  function createProfile(u, extra){
    var doc = {
      name: extra.name || u.displayName || (u.email || '').split('@')[0] || 'Kullanıcı',
      email: u.email || '',
      role: extra.role || 'planner',
      // 'work' or 'personal': decides which planner fields the account ever sees
      usage: extra.usage === 'personal' ? 'personal' : 'work',
      company: extra.company || '',
      photoURL: u.photoURL || '',
      createdAt: Date.now()
    };
    return profileRef(u.uid).set(doc, { merge: true }).then(function(){
      profile = doc;
      notify();
      return doc;
    }).catch(function(err){
      console.warn('Profil oluşturulamadı:', err.message);
      profile = doc;   // keep the UI usable even if the write was rejected
      notify();
      return doc;
    });
  }

  function updateProfile(fields){
    if(!isSignedIn()) return Promise.reject(new Error('Giriş yapılmamış'));
    return profileRef(currentUser.uid).set(fields, { merge: true }).then(function(){
      profile = Object.assign({}, profile, fields);
      notify();
      return profile;
    });
  }

  function requireReady(){
    if(!available()) return Promise.reject(new Error('Firebase yapılandırılmamış'));
    return RP.storage.init();
  }

  function signInGoogle(){
    return requireReady().then(function(){
      var provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      var auth = firebase.auth();
      var anon = auth.currentUser;

      /* Upgrading the anonymous session keeps any routes a guest already saved.
         Any failure here (account already exists, linking unsupported) must still
         let the user in, so it falls back to a plain sign-in. */
      if(anon && anon.isAnonymous && typeof anon.linkWithPopup === 'function'){
        return Promise.resolve()
          .then(function(){ return anon.linkWithPopup(provider); })
          .catch(function(err){
            if(err && err.code === 'auth/popup-closed-by-user') throw err;
            console.warn('Anonim oturum yükseltilemedi, normal giriş deneniyor:', err && err.message);
            return auth.signInWithPopup(provider);
          });
      }
      return auth.signInWithPopup(provider);
    }).then(function(cred){
      var u = cred.user;
      return profileRef(u.uid).get().then(function(snap){
        if(snap.exists){ profile = snap.data(); return profile; }
        return createProfile(u, {});
      });
    });
  }

  function signUpEmail(name, email, password, role, usage){
    pendingSignup = { name: name, role: role, usage: usage };
    return requireReady().then(function(){
      var auth = firebase.auth();
      var anon = auth.currentUser;
      if(anon && anon.isAnonymous && typeof anon.linkWithCredential === 'function'){
        var credential = firebase.auth.EmailAuthProvider.credential(email, password);
        return Promise.resolve()
          .then(function(){ return anon.linkWithCredential(credential); })
          .catch(function(err){
            // a taken address is the user's problem to fix; anything else just
            // falls back to creating a fresh account
            if(err && (err.code === 'auth/email-already-in-use' ||
                       err.code === 'auth/credential-already-in-use')) throw err;
            console.warn('Anonim oturum yükseltilemedi, yeni hesap açılıyor:', err && err.message);
            return auth.createUserWithEmailAndPassword(email, password);
          });
      }
      return auth.createUserWithEmailAndPassword(email, password);
    }).then(function(cred){
      var u = cred.user;
      return u.updateProfile({ displayName: name }).catch(function(){}).then(function(){
        return createProfile(u, { name: name, role: role, usage: usage });
      });
    }).then(function(doc){
      pendingSignup = null;
      return doc;
    }, function(err){
      pendingSignup = null;
      throw err;
    });
  }

  function signInEmail(email, password){
    return requireReady().then(function(){
      return firebase.auth().signInWithEmailAndPassword(email, password);
    });
  }

  function resetPassword(email){
    return requireReady().then(function(){
      return firebase.auth().sendPasswordResetEmail(email);
    });
  }

  function signOut(){
    if(!available()) return Promise.resolve();
    return firebase.auth().signOut().then(function(){
      currentUser = null;
      profile = null;
      notify();
    });
  }

  var MESSAGES = {
    'auth/invalid-email': 'E-posta adresi geçersiz.',
    'auth/user-disabled': 'Bu hesap devre dışı bırakılmış.',
    'auth/user-not-found': 'Bu e-posta ile kayıtlı hesap yok.',
    'auth/wrong-password': 'Şifre hatalı.',
    'auth/invalid-credential': 'E-posta veya şifre hatalı.',
    'auth/email-already-in-use': 'Bu e-posta zaten kayıtlı — giriş yapmayı dene.',
    'auth/weak-password': 'Şifre en az 6 karakter olmalı.',
    'auth/popup-closed-by-user': 'Google penceresi kapatıldı.',
    'auth/popup-blocked': 'Tarayıcı açılır pencereyi engelledi — izin verip tekrar dene.',
    'auth/cancelled-popup-request': 'Önceki giriş penceresi iptal edildi.',
    'auth/network-request-failed': 'İnternet bağlantısı kurulamadı.',
    'auth/too-many-requests': 'Çok fazla deneme yapıldı — biraz sonra tekrar dene.',
    'auth/operation-not-allowed': 'Bu giriş yöntemi Firebase konsolunda açık değil (Authentication → Sign-in method).',
    'auth/configuration-not-found': 'Firebase projesinde Authentication henüz açılmamış. Konsolda Build → Authentication → Get started deyip Email/Password, Google ve Anonymous yöntemlerini etkinleştir.',
    'auth/api-key-not-valid': 'Firebase API anahtarı geçersiz — js/firebase-config.js içindeki değerleri kontrol et.',
    'auth/invalid-api-key': 'Firebase API anahtarı geçersiz — js/firebase-config.js içindeki değerleri kontrol et.',
    'auth/unauthorized-domain': 'Bu alan adı Firebase’de yetkili değil (Authentication → Settings → Authorized domains).'
  };

  function friendlyError(err){
    if(!err) return 'Bilinmeyen hata';
    return MESSAGES[err.code] || err.message || 'Bilinmeyen hata';
  }

  return {
    available: available,
    start: start,
    onChange: onChange,
    isSignedIn: isSignedIn,
    user: user,
    profile: profileData,
    signInGoogle: signInGoogle,
    signUpEmail: signUpEmail,
    signInEmail: signInEmail,
    resetPassword: resetPassword,
    updateProfile: updateProfile,
    signOut: signOut,
    friendlyError: friendlyError
  };
})();
