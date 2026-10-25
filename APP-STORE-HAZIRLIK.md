# App Store için iOS hazırlığı

Bu proje mevcut HTML/CSS/JavaScript arayüzünü Capacitor ile iOS uygulama paketine
dönüştürür. Hatırlatmalar cihazda saklanır; iOS yerel bildirim izni verildiğinde
yaklaşan hatırlatmalar sistem bildirimleri olarak planlanır.

## Gerekenler

- macOS yüklü bir Mac, desteklenen Xcode sürümü ve Xcode Command Line Tools
- Node.js 20 veya üzeri ve npm
- App Store Connect erişimi olan Apple Developer Program hesabı
- Uygulama için benzersiz bir Bundle ID ve App Store Connect kaydı

Capacitor iOS kaynak projesi `ios/` klasörüne oluşturulmuş ve mevcut web uygulaması
ile eklentiler eşitlenmiştir. Windows bu projeyi hazırlayıp inceleyebilir; ancak
Xcode yalnızca macOS üzerinde çalıştığından iOS simülatör/cihaz derlemesi, imzalama
ve App Store yüklemesi Windows'ta doğrulanamaz veya yapılamaz. Bu bilgisayarda
yapılandırılmış bir Git uzak deposu bulunmadığı için hiçbir proje kaynağı bulut
derleme hizmetine gönderilmemiştir.

## Mac üzerinde derleme ve doğrulama

Proje klasöründe aşağıdaki komutları çalıştırın:

```sh
npm install
npm run ios:sync
npm run ios:open
```

`ios:sync`, web uygulamasını derleyip uygulama dosyalarını ve Capacitor eklentilerini
mevcut Xcode projesine kopyalar. Mac üzerinde Xcode ve CocoaPods kurulu olmalıdır.
Windows'ta proje hazırlanırken `pod` ve `xcodebuild` bulunmadığından yerel iOS
derlemesi ve yerel eklenti entegrasyonu henüz test edilmemiştir.

## Ana ekran ve kilit ekranı widget'ları

Üretilen Capacitor iOS projesini Xcode'da açtıktan sonra:

1. `File > New > Target > Widget Extension` ile `HatirlaticilarimWidgetExtension`
   adlı bir widget uzantısı ekleyin. Xcode'un oluşturduğu örnek widget giriş dosyasını
   uzantı hedefinden çıkarın; bu depodaki `ios-widget/HatirlaticilarimWidget.swift`
   dosyasını projeye ekleyip yalnızca widget uzantısına dahil edin.
2. Uygulama hedefinin ve widget uzantısının `Signing & Capabilities` bölümüne
   **App Groups** yeteneğini ekleyin. Her iki hedefte de aynı
   `group.com.hatirlaticilarim.app` grubunu seçin. Gerekirse Apple Developer
   hesabında bu App Group'u oluşturup her iki App ID'ye bağlayın. Depodaki
   `ios-widget/App.entitlements` ve `ios-widget/Widget.entitlements` dosyaları
   bu grup kimliği için örnek yetki dosyalarıdır; Xcode'un oluşturduğu dosyalara
   aynı App Group değerinin eklendiğini doğrulayın. Uygulamaya özel başka bir grup
   kimliği seçerseniz bu yetki dosyalarında, WidgetBridge ve WidgetKit Swift
   kaynaklarında aynı yeni kimliği kullanın.
3. Hem uygulama hem widget uzantısının iOS dağıtım hedefini 16.0 veya üzeri yapın.
   Uygulama hedefinin Bundle ID'si `capacitor.config.json` ile aynı olmalı;
   uzantının Bundle ID'si uygulama kimliğinin sonuna `.widget` eklenerek benzersiz
   yapılmalıdır.
4. Widget uzantısını imzalayıp gerçek cihazda çalıştırın. Ana ekranda boş alana uzun
   basıp `+` ile **Sıradaki Hatırlatma** widget'ını ekleyin. Kilit ekranında kilide
   uzun basıp `Özelleştir` üzerinden dikdörtgen veya satır içi widget seçin.

Widget Extension hedefini ekledikten sonra her web/eklenti güncellemesinde
`npm run ios:sync` çalıştırın; widget uzantısını Xcode'da seçip gerçek cihazda test edin.
Ana ekran widget'ı sıradaki hatırlatmayı ve bugünkü bekleyen sayısını; kilit ekranı
widget'ları sıradaki hatırlatmanın başlığını ve saatini gösterir. Başlık kilit
ekranında görünebilir. Uygulama hatırlatma değişikliklerini paylaşılan App Group
alanına gönderir ve widget zaman çizelgelerini yeniler. iOS widget'ların ne zaman
yenileneceğini işletim sistemi belirler; yenilenme anlık olmak zorunda değildir.
iOS 26'da sistem Liquid Glass görünümünü widget yüzeyine kendisi uygular; daha eski
sürümlerde sistem arka planı veya materyal görünümü kullanılır.

Xcode'da `Signing & Capabilities` bölümünden Apple geliştirici takımınızı seçin.
`capacitor.config.json` içindeki `appId` değerini App Store Connect uygulamasında
kullandığınız benzersiz Bundle ID ile eşleştirin. Her arşiv öncesinde
`npm run ios:sync` komutunu çalıştırın. Xcode'dan `Product > Archive` ile dağıtım
arşivini hazırlayıp Organizer üzerinden App Store Connect'e yükleyin.

## Yayın öncesi tamamlanacaklar

- Gerçek iPhone ve iPad cihazlarında arayüzü, bildirim iznini, tekrarları ve erişilebilirliği sınayın.
- Uygulama adı, Bundle ID, sürüm/derleme numarası ve mağaza simgelerini son hâline getirin.
- App Store Connect gizlilik etiketlerini, destek bağlantısını, açıklamayı ve ekran görüntülerini doldurun.
- Veri saklama ve gizlilik açıklamalarını içeren erişilebilir bir gizlilik politikası URL'si sağlayın.
- Apple incelemesi için hatırlatma oluşturma, düzenleme, silme, tekrar ve bildirim izinlerini açıklayın.
- Apple'ın güncel inceleme kurallarını, iOS SDK hedeflerini ve yükleme şartlarını kontrol edin.

## App Store açıklama taslağı

**Hatırlatıcılarım**, günlük görevlerinizi planlamanıza ve yaklaşan işleri takip
etmenize yardımcı olur. Hatırlatmalarınıza tarih, saat, not, kategori ve öncelik
ekleyebilir; günlük, hafta içi, haftalık veya aylık tekrar seçeneklerini
kullanabilirsiniz. Arama ve süzgeçlerle listenizi düzenleyebilir, açık ya da koyu
tema seçebilirsiniz.

Ana ekran widget'ında sıradaki hatırlatmayı ve bugünkü bekleyen sayısını,
kilit ekranı widget'ında sıradaki başlığı ve saati görüntüleyebilirsiniz.
Widget güncellemelerinin zamanını iOS belirler.

Bildirim izni istenmeden önce uygulama, bildirimlerin amacını ve çalışma şeklini
açıklar. iPhone'un sistem izin penceresi yalnızca **Devam et** seçilince açılır;
**Şimdi değil** seçimi izin isteği göndermez. Uygulama iOS Ayarlar'ını kendiliğinden
açmaz veya ayarları değiştirmez. Yakın gelecekte eklenecek sistem izinleri de önce
aynı açıklama ve kullanıcı onayından geçirilmelidir.
Kullanıcı özel alarm sesi için dosya seçiciyi açmadan önce de hangi dosyaya erişileceği
açıklanır; yalnızca kişinin seçtiği, boyutu sınırlandırılmış ses dosyası okunup cihazda
saklanır. Uygulama fotoğraf arşivine erişim istemez.

Bildirim izni verdiğinizde uygulama yaklaşan hatırlatmaları iOS bildirimleri olarak
1 gün, 1 saat, 30 dakika, 10 dakika ve 5 dakika önce, ayrıca vaktinde planlar.
Uygulama bir uyarı eşiği geçtikten sonra açılırsa geçmiş aşamaları sonradan göndermez;
yalnızca sıradaki yaklaşan aşamaları ve hatırlatma saatini planlar.
Bir sonraki tekrarın bildirimleri, tekrarlı hatırlatma tamamlanıp yeni zamanı
oluştuğunda planlanır. iOS'ta toplam en fazla 64 yaklaşan bildirim sıraya alınır.
Kendi seçtiğiniz ses uygulama açıkken çalar; iOS bildirimleri sistem sesini kullanır.
Hatırlatmalarınız
bu cihazda saklanır ve başka cihazlarla otomatik eşitlenmez.

Web sürümündeki bildirimler yalnızca uygulama sayfası açıkken kontrol edilir.
iOS yerel bildirimleri uygulama kapalıyken çalışır; tekrarlı hatırlatmanın sıradaki
zamanı, mevcut bildirim gerçekleşip uygulama tekrar açılana dek planlanmayabilir.
App Store kabulü garanti edilemez. Apple, web içeriğini yalnızca saran ve yeterli yerel
işlev sunmayan uygulamaları reddedebilir. Yerel bildirim izni kullanıcı tarafından
istenir; iOS en fazla 64 gelecek bildirim aşamasını sıraya alır. Bu nedenle çok sayıda
yakın hatırlatmada her uyarı aşaması sıraya girmeyebilir.
Kullanıcının seçtiği özel ses dosyası iOS bildirim sesine kopyalanmaz; işletim
sisteminin bildirim sesi kullanılır. Uygulama açıkken mevcut özel ses özelliği çalışır.
Safari/PWA yerel depolaması ile Capacitor uygulamasının depolaması ayrı olduğundan
mevcut hatırlatmalar yeni yerel uygulamaya otomatik aktarılmaz.

**Açıklama:** Bu uygulama yapay zekâ desteğiyle geliştirilmiştir.
