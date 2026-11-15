# Çevirilerim

Hatırlatıcılarım'ın altyapısı (Vite + PWA + Capacitor iOS) ve tasarım dili taban
alınarak hazırlanan Türkçe arayüzlü çeviri uygulaması. Web/PWA olarak çalışır;
Capacitor yapılandırması iOS kabuğu oluşturmaya hazırdır.

## Özellikler

- 41 dil arasında çeviri; kaynak dil için otomatik algılama
- Dilleri ve metinleri tek dokunuşla yer değiştirme. Kaynak ile hedef aynı dile
  getirilirse diğer seçim kendiliğinden kayar.
- Satır ve paragraf yapısını koruyarak uzun metin çevirisi (tek seferde 5.000 karaktere kadar)
- Seslendirme, kopyalama ve destekleyen cihazlarda paylaşma
- Bu cihazda saklanan geçmiş ve favoriler, Türkçe harf ve aksan duyarsız arama
- Daha önce yapılmış bir çeviri, kota harcamadan ve internetsiz geçmişten getirilir
- Günlük kota sayacı; isteğe bağlı e-posta ile günlük sınır 5.000'den 50.000 karaktere çıkar
- Destekleyen tarayıcılarda (ör. Chrome 138+ masaüstü) cihaz içi çeviri modeli
  indirilmişse çeviri internetsiz yapılır
- Açık/koyu tema, çevrimdışı açılan web uygulaması, yazılan metnin taslak olarak saklanması

## Gizlilik

Çevrimiçi çeviride metin [MyMemory](https://mymemory.translated.net/)
(Translated S.r.l.) sunucularına gönderilir. Metin ilk kez cihazdan çıkmadan önce
uygulama bunu açıklar ve onay ister. "Şimdi değil" seçilirse hiçbir istek
gönderilmez. Onay Ayarlar bölümünden geri alınabilir.

Geçmiş, ayarlar ve taslak yalnızca bu cihazın yerel deposunda kalır.

## Çalıştırma

Node.js 20 veya üzeri ve npm gereklidir. Komutlar bu klasörde (`ceviri/`) çalıştırılır:

```sh
npm install
npm run dev      # geliştirme sunucusu
npm test         # çeviri motoru birim testleri (node:test)
npm run build    # üretim dosyaları: dist/
npm run preview  # derlenmiş sürümü yerelde dener
```

## iOS

Xcode projesi `ios/App` altında hazırdır (Bundle ID `com.cevirilerim.app`, iOS 14.0+).
macOS'ta Xcode ve CocoaPods kuruluyken:

```sh
npm install
npm run ios:sync           # web paketini derleyip iOS projesine aktarır
(cd ios/App && pod install)
npm run ios:open           # Xcode'da açar
```

Depodaki `.github/workflows/ios-build.yml` bu uygulamayı da her push'ta GitHub'ın macOS
makinesinde test edip cihaz ve simülatör için derler. `ceviri-v1.0.0` gibi bir etiket
push edildiğinde veya Actions'ta elle başlatılıp *TestFlight* seçildiğinde imzalı derleme
TestFlight'a yüklenir (gerekli GitHub Secrets için kökteki `APP-STORE-HAZIRLIK.md`'ye bakın;
App Store Connect'te `com.cevirilerim.app` kaydı oluşturulmuş olmalıdır).

`capacitor.config.json` içinde `CapacitorHttp` etkindir. Böylece iOS kabuğundaki
çeviri istekleri tarayıcı CORS kısıtına takılmadan yerel HTTP ile gönderilir.
Windows'ta `derle.bat` web paketini derleyip `cap sync ios` çalıştırır; `pod install`
adımı Mac'te yapılmalıdır.

## Dosyalar

| Dosya | Görevi |
| --- | --- |
| `index.html`, `style.css` | Arayüz; renkler ve bileşenler Hatırlatıcılarım ile ortaktır |
| `script.js` | Arayüz davranışı: dil seçimi, çeviri akışı, geçmiş, ayarlar, onay |
| `ceviri-motoru.js` | DOM'suz çeviri mantığı: parçalama, MyMemory istemcisi, cihaz içi çeviri, geçmiş ve kota yardımcıları |
| `diller.js` | Dil listesi ve dil kodu eşleme yardımcıları |
| `public/` | Adı değişmeden `dist/` köküne kopyalanan manifest, simgeler ve service worker |
| `test/` | `npm test` ile çalışan birim testleri |

## Kısıtlar

- MyMemory tek istekte en fazla 500 bayt kabul eder. Uzun metin cümle, kelime ve
  gerekirse karakter sınırlarından bölünüp sırayla gönderilir.
- Ücretsiz kullanım günlük karakterle sınırlıdır ve servis bu sınırı bağlantı
  adresine göre uygular. Uygulamadaki sayaç bu cihazdaki kullanımı gösterir, yaklaşıktır.
- Yeni çeviri için internet gerekir. Çevrimdışıyken arayüz açılır, geçmişteki
  çeviriler kullanılabilir.
- Makine çevirisi hatalı olabilir; önemli metinleri kontrol ettirin.

**Açıklama:** Bu uygulama yapay zekâ desteğiyle geliştirilmiştir.
