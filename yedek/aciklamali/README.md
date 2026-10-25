# Hatırlatıcılarım

Günlük görevleri ve yaklaşan tarihleri planlamak için Türkçe bir hatırlatıcı
uygulaması. Arayüzü web/PWA olarak çalışır; Capacitor kaynakları iOS uygulama
kabuklarını oluşturmaya ve senkronize etmeye hazırdır.

## Özellikler

- Kategoriler, öncelikler, arama, süzgeçler ve yaklaşan hatırlatmalar özeti
- Günlük, hafta içi, haftalık veya aylık; isteğe bağlı bitiş tarihli tekrarlar
- Hatırlatma zamanı yaklaşırken artan sıklıkta yerel/tarayıcı bildirimleri
- Uygulama açıkken çalabilen seçilebilir özel alarm sesi
- Açık/koyu görünüm, çevrimdışı web uygulaması ve iOS WidgetKit kaynakları
- Sistem izinleri ve dosya seçimi öncesinde açıklamalı kullanıcı onayı

Hatırlatmalar bu cihazın yerel deposunda kalır; başka cihazlarla otomatik
eşitlenmez.

## Web uygulamasını çalıştırma

Node.js 20 veya üzeri ve npm gereklidir:

```sh
npm install
npm run dev
```

Üretim dosyalarını oluşturmak için:

```sh
npm run build
```

## iOS

Capacitor iOS kaynak projesi `ios/` klasöründedir. Web paketini ve yerel
eklenti kaynaklarını güncellemek için:

```sh
npm run ios:sync
```

iOS uygulamasını derlemek, imzalamak, simülatör/cihazda test etmek ve App Store'a
yüklemek için macOS, Xcode ve CocoaPods gerekir. Widget Extension hedefi Xcode'da
ayrıca yapılandırılmalıdır. Adımlar ve yayın kısıtları
[App Store hazırlık belgesinde](./APP-STORE-HAZIRLIK.md) açıklanmıştır.

## Yedekler

- `yedek/orijinal/`: Değişiklik öncesindeki kaynak kopyası
- `yedek/aciklamali/`: Güncel kaynakların ve iOS projesinin Türkçe açıklamalı yedeği

Kaynakta değişiklik yaparken bu iki yedek düzenini koruyun.

## Bildirim kısıtları

- Web bildirimleri yalnızca uygulama açıkken kontrol edilir.
- iOS en fazla 64 gelecek yerel bildirim aşamasını sıraya alabilir.
- Tekrarlı hatırlatmanın yeni bildirimi, uygulama bir sonraki tekrarı
  oluşturduktan sonra planlanır.
