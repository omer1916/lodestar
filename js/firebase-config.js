window.RP = window.RP || {};

/* ---------------------------------------------------------------------------
   Sitenin bağlı olduğu Firebase projesi. Kullanıcılar hiçbir ayar yapmaz;
   sadece kayıt olup giriş yaparlar.

   Bu değerler GİZLİ DEĞİLDİR. Firebase web config'i projeyi tanımlar, yetki
   vermez — erişimi firestore.rules dosyasındaki güvenlik kuralları belirler.
   Bu yüzden herkese açık bir repoda durması normaldir ve Firebase'in kendi
   dokümantasyonu da böyle önerir.

   Değiştirmek/yenisini almak için: kurulum.html sayfasındaki adımlar.
--------------------------------------------------------------------------- */
RP.firebaseConfig = {
  apiKey: "AIzaSyBtSixjkk4q2jMLr6Cel3xMFYrbRDQuycc",
  authDomain: "routeplain.firebaseapp.com",
  projectId: "routeplain",
  storageBucket: "routeplain.firebasestorage.app",
  messagingSenderId: "823850071880",
  appId: "1:823850071880:web:988ed5e9a31ee39c2de57d"
  // measurementId (Analytics) kullanılmıyor — uygulama Analytics yüklemiyor.
};

/* Hangi giriş yöntemleri açık? Firebase konsolunda (Authentication → Sign-in
   method) etkinleştirdiklerinle aynı olmalı — kapalı bir yöntemin butonunu
   göstermek kullanıcıya çalışmayan bir düğme sunar.

   Google'ı açmak için: konsolda Google sağlayıcısını etkinleştir (herkese açık
   proje adı + destek e-postası ister), sonra buradaki değeri true yap. */
RP.authProviders = {
  email: true,
  google: false
};

/* Config boşsa uygulama "kurulum gerekli" moduna düşer. */
RP.hasBuiltInConfig = !!(RP.firebaseConfig.apiKey && RP.firebaseConfig.projectId);
