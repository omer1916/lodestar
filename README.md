# RotaPlan

**Kargo ve kurye teslimatları için çok duraklı rota optimizasyonu.** Tarayıcıda çalışır,
kurulum istemez.

Durakları girersin; uygulama en kısa ziyaret sırasını hesaplar, rotayı gerçek yol ağı
üzerinden çizer, canlı trafiği hesaba katar, şoförüne atar ve teslimatları anlık takip
etmeni sağlar.

> **Canlı demo:** _(yayına aldıktan sonra link buraya)_

---

## Ne işe yarar

Günde 15 adrese teslimat yapan bir kurye, adresleri elle sıraladığında tipik olarak
%20-30 fazla yol yapar. RotaPlan bu sıralamayı hesaplar ve farkı gösterir:

> Optimize sıralama **%31 daha kısa** — girilen sırayla 9,4 km fazla yol yapılacaktı.
> ~2,8 L · ~128 ₺ yakıt · ~7,6 kg CO₂

Sadece "en kısa yol" değil; kapasite, teslim saatleri ve vardiya süresi gibi gerçek
kısıtları da hesaba katar.

---

## Özellikler

### Rota optimizasyonu
- Nearest-neighbor + **2-opt** yerel arama ile durak sıralama
- 12+ durakta **simulated annealing** (tavlama benzetimi) devreye girer — ölçümlerde
  2-opt sonucunu ortalama **%3,85** daha kısaltıyor
- **Sweep algoritması** ile çoklu araç dağıtımı (depo etrafında açısal tarama + kapasite)
- Sıralama, TomTom Matrix Routing v2 ile gerçek yol mesafesine göre yapılır (anahtar varsa)

### Lojistik kısıtları
- **Araç kapasitesi** — durak başına yük, kapasite dolunca sonraki araca aktarılır
- **Zaman penceresi** — "09:00-11:00 arası teslim"; gecikme riski olan duraklar işaretlenir
- **Vardiya süresi** — aşan duraklar tek tıkla ertesi güne aktarılır
- Her durak için tahmini varış saati (ETA)

### Trafik
- TomTom anahtarı varsa rota **canlı trafiğe göre** hesaplanır; yoğun yollardan kaçınır
- **Yoğunluk haritada renklenir** — sarı (hafif), turuncu (orta), kırmızı (yoğun),
  koyu kırmızı (durma/kapalı). Tıklayınca gecikme ve ortalama hız görünür
- "Mesafe" seçilirse en kısa yol, "Süre" seçilirse en hızlı yol istenir
- Anahtar yoksa ücretsiz OSRM ile trafiksiz gerçek yol rotası çizilir

### Canlı yeniden rotalama
Şoför yoğun bir tıkanıklığa **2 km kala** alternatif yol taranır — trafiğe girmeden,
hâlâ sapma şansı varken. Kayda değer kazanç varsa ekranda öneri çıkar.

Kota dostu tetikleme: yalnızca kırmızı ve üzeri tıkanıklıklar sayılır, aynı tıkanıklık
bir kez taranır, en az 3 dk ara ve 700 m ilerleme gerekir, günlük 60 tarama tavanı vardır.
Yedek tetikleyici anlık hıza değil **5 dakikada kat edilen yola** bakar — böylece kırmızı
ışıkta boşuna tarama yapılmaz.

### Veri girişi
- Adres araması (OpenStreetMap Nominatim) + otomatik tamamlama
- Haritadan tıklayarak seçme, pinleri sürükleyerek taşıma
- **CSV içe aktarma** — adres, yük, telefon ve zaman penceresi sütunlarıyla
- **Fotoğraftan adres okuma (OCR)** — teslimat listesinin fotoğrafından satırları çıkarır
- **Barkod / QR okuma** — paket etiketinden durak ekleme
- **Adres defteri** — sık gidilen noktaları kaydet, tek tıkla ekle
- Durakları **sürükle-bırak** ile elle sıralama (dokunmatikte de çalışır)

### Hesaplar ve roller
- Firebase Auth ile e-posta/şifre kaydı ve giriş, şifre sıfırlama
  (Google girişi kodda hazır, konsoldan açılınca tek satırla etkinleşir)
- Kayıtta **planlayıcı / şoför** rolü seçimi
- Rotalar hesaba bağlı saklanır — telefondan da bilgisayardan da aynı liste

### Şoför ekranı
- Kendisine atanan rotalar listesi
- Sıralı durak listesi, sıradaki durak vurgusu, ETA
- Tek dokunuşla **Google Maps / Yandex Navigasyon**, müşteriye **WhatsApp** ETA mesajı
- **Teslim edildi / edilemedi** işaretleme: sebep, not ve **fotoğraflı teslimat kanıtı**
- Konum paylaşımı — merkez şoförü haritada canlı görür
- Hesapsız da çalışır: paylaşılan şoför linki yeterli

### Paylaşım ve takip
- **Takip linki** — müşteri/ekip rotayı salt-okunur görür
- **Canlı teslimat ilerlemesi** — X/Y teslim, durak durum etiketleri, anlık güncellenir
- **Yazdırılabilir teslimat listesi** (imza sütunlu; tarayıcının "PDF olarak kaydet"i ile PDF)
- **Özet sayfası** — toplam rota/km/durak, teslim başarı oranı, zaman penceresi uyumu, yakıt gideri

### Arayüz
- Tanıtım sayfası + planlama uygulaması + şoför ekranı + takip + özet
- Açık/koyu tema, tamamen mobil uyumlu
- **PWA** — telefona kurulabilir, çevrimdışı açılır
- Emoji yerine satır içi SVG ikonlar (her platformda aynı görünür)

---

## Teknoloji

| Katman | Kullanılan |
|---|---|
| Arayüz | Vanilla JS (ES5 uyumlu), CSS değişkenleriyle tema, bağımlılıksız modüler yapı |
| Harita | Leaflet + OpenStreetMap |
| Rota / trafik | TomTom Routing API (canlı trafik), OSRM (ücretsiz yedek) |
| Mesafe matrisi | TomTom Matrix Routing v2 |
| Geocoding | Nominatim (OpenStreetMap) |
| OCR | Tesseract.js (tamamen istemci tarafında) |
| Barkod | BarcodeDetector API + jsQR (yedek) |
| Backend | Firebase Firestore + Firebase Auth |
| PWA | Web App Manifest + Service Worker |

**Build aracı, paket yöneticisi, derleme adımı yok.** Statik dosyalar; herhangi bir yere
kopyalayınca çalışır.

---

## Çalıştırma

```bash
git clone https://github.com/omer1916/rotaplan.git
cd rotaplan
python -m http.server 8080
```

Sonra `http://localhost:8080` adresini aç.

> **Not:** Bir dosyayı değiştirip yayına aldığında HTML'lerdeki `?v=35` sürüm numarasını
> artır, yoksa ziyaretçilerin tarayıcısı eski dosyayı önbellekten sunabilir.

### Kendi Firebase projenle kurmak

Depodaki `js/firebase-config.js` bir Firebase projesine bağlıdır. Kendi projenle
çalıştırmak istersen:

1. [Firebase konsolunda](https://console.firebase.google.com/) proje oluştur
2. **Security → Authentication → Get started**, ardından *Sign-in method* sekmesinden
   **Email/Password** ve **Anonymous**'ı etkinleştir
3. **Databases & Storage → Firestore Database → Create database** (bölge: `eur3`)
4. **Project settings → General → Your apps** bölümünden web uygulaması ekle, çıkan
   `firebaseConfig` değerlerini `js/firebase-config.js` dosyasına yaz
5. **Firestore Database → Rules** sekmesine [`firestore.rules`](firestore.rules)
   içeriğini yapıştır ve **Publish** de
6. Yayına aldığın alan adını **Authentication → Settings → Authorized domains**'e ekle
7. İsteğe bağlı: [`firestore.indexes.json`](firestore.indexes.json) içindeki iki indeksi
   oluştur (indekssiz de çalışır, geçmiş listesi büyüdüğünde sıralama için gerekir)

Firebase web config'i **gizli anahtar değildir** — projeyi tanımlar, yetki vermez.
Erişimi güvenlik kuralları belirler. Bu yüzden depoda durması normaldir ve Firebase'in
kendi dokümantasyonu da böyle önerir.

### Canlı trafik (isteğe bağlı)

[developer.tomtom.com](https://developer.tomtom.com/user/register) üzerinden ücretsiz
anahtar al (günde 2.500 istek, kredi kartı istemez), uygulamada *Ayarlar → TomTom API Key*
alanına yapıştır. Gereken API'ler: Routing, Traffic, Matrix Routing v2, Geocoding,
Reverse Geocoding. Anahtar yalnızca kullanıcının tarayıcısında saklanır.

---

## Güvenlik

Firestore güvenlik kuralları [`firestore.rules`](firestore.rules) dosyasında ve
**14 saldırı senaryosuyla canlı test edilmiştir**:

- Kullanıcı profilleri ve adres defteri yalnızca sahibine açık
- Rotalar sahibine ve atanan şoföre açık; paylaşım linkiyle **tek doküman** okunabilir
  ama koleksiyon **listelenemez** — bu ayrım olmadan tüm veritabanı dökülebiliyordu
- Teslimat kaydı silmek yalnızca rota sahibinde: kanıt yok edilemez
- Teslimat kayıtlarında alan listesi, durum değeri ve boyut doğrulaması
- Konum güncellemelerinde tip ve enlem/boylam aralığı kontrolü
- Rota sahipliği güncellemede kilitli

**Bilinçli tasarım tercihi:** şoför linkini bilen kişi konum paylaşabilir ve teslimat
işaretleyebilir. Hesabı olmayan kuryelerin çalışabilmesi için böyledir — link burada
bir tür anahtardır, ilgisiz kişilere gönderilmemelidir.

---

## Kapsam notu

Optimizasyon gerçek bir VRP/VRPTW çözücüsü değil, **sezgisel (heuristic)** bir
yaklaşımdır: kapasite greedy olarak doldurulur, zaman pencereleri yumuşak kısıt olarak
maliyet fonksiyonuna eklenir. Pratikte çok iyi sonuç verir; matematiksel olarak "kesin en
iyi" olduğu garanti edilmez. Sıralamayı sürükleyerek elle de değiştirebilirsin.

---

## Proje yapısı

```
rotaplan/
├── index.html             # tanıtım / kapak sayfası
├── app.html               # planlama ekranı
├── driver.html            # şoför ekranı (rota, navigasyon, teslimat, konum)
├── view.html              # paylaşılan rota (salt okunur + canlı takip)
├── stats.html             # rota özeti / analitik
├── kurulum.html           # nasıl kullanılır kılavuzu
├── firestore.rules        # güvenlik kuralları (konsola yapıştırılır)
├── firestore.indexes.json # bileşik indeks tanımları
├── css/style.css          # tema değişkenleri, bileşenler, yazdırma stilleri
├── js/
│   ├── firebase-config.js # Firebase projesi (gizli değil)
│   ├── icons.js           # satır içi SVG ikon seti
│   ├── geo.js             # geocoding, reverse geocoding, haversine
│   ├── optimize.js        # nearest-neighbor, 2-opt, tavlama, sweep, zaman penceresi
│   ├── routing.js         # OSRM + TomTom rota, trafik bölümleri, mesafe matrisi
│   ├── reroute.js         # canlı yeniden rotalama ve kota koruması
│   ├── storage.js         # Firestore: kayıt, geçmiş, paylaşım, atama, teslimat
│   ├── auth.js            # Firebase Auth sarmalayıcı, roller
│   ├── auth-ui.js         # giriş/kayıt modalı, oturum göstergesi
│   ├── delivery.js        # teslimat durumu, fotoğraf sıkıştırma, navigasyon linkleri
│   ├── importers.js       # CSV ayrıştırma
│   ├── ocr.js             # Tesseract.js ile fotoğraftan adres
│   ├── scanner.js         # barkod / QR okuma
│   ├── pdf.js             # yazdırılabilir teslimat listesi
│   └── app.js             # arayüz ve akış yönetimi
├── manifest.json          # PWA
└── sw.js                  # service worker
```

---

## Lisans

MIT
