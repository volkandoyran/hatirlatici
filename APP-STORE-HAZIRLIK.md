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

Widget uzantısı Xcode projesine eklenmiştir; elle hedef oluşturmaya gerek yoktur:

- `HatirlaticilarimWidgetExtension` hedefi `ios/App/HatirlaticilarimWidget/` klasöründeki
  `HatirlaticilarimWidget.swift`, `Info.plist` ve yetki dosyasını kullanır; Bundle ID'si
  `com.hatirlaticilarim.app.widget`, dağıtım hedefi iOS 16.0'dır.
- Uzantı, `App` hedefine bağımlıdır ve `Embed Foundation Extensions` aşamasıyla
  `App.app/PlugIns/` içine gömülür. Paylaşılan `App` şeması her iki hedefi birlikte derler.
- Uygulama (`ios/App/App/App.entitlements`) ve widget aynı
  `group.com.hatirlaticilarim.app` App Group'unu kullanır. Otomatik imzalama bu grubu
  genellikle kendisi kaydeder; kaydetmezse Apple Developer hesabında App Group'u oluşturup
  her iki App ID'ye bağlayın. Başka bir grup kimliği seçerseniz iki yetki dosyasında,
  WidgetBridge ve WidgetKit Swift kaynaklarında aynı kimliği kullanın.

Mac'te `npm run ios:open` ile projeyi açın, `Signing & Capabilities` bölümünde iki hedef
için de geliştirici takımınızı seçin ve gerçek cihazda çalıştırın. Ana ekranda boş alana
uzun basıp `+` ile **Sıradaki Hatırlatma** widget'ını ekleyin. Kilit ekranında kilide uzun
basıp `Özelleştir` üzerinden dikdörtgen veya satır içi widget seçin.

Her web/eklenti güncellemesinde
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

## GitHub Actions ile macOS derlemesi ve TestFlight

`.github/workflows/ios-build.yml` GitHub'ın macOS makinelerinde çalışır:

- **İmzasız derleme** her `main`/`claude/**` push'unda, `main`'e açılan PR'larda ve
  Actions sekmesinden **Run workflow** ile çalışır. Cihaz ve simülatör için derler,
  widget uzantısının pakete gömüldüğünü doğrular; `Hatirlaticilarim-imzasiz.ipa` ve
  `Hatirlaticilarim-simulator.app.zip` dosyalarını çalıştırma sayfasından indirilebilir bırakır.
- **İmzalı derleme ve TestFlight**, `v1.0.0` gibi bir `v*` etiketi push edildiğinde veya
  **Run workflow** penceresinde *İmzalı derleyip TestFlight'a yükle* işaretlendiğinde çalışır.
  Derleme numarası olarak GitHub çalıştırma numarası kullanılır; sürüm (`MARKETING_VERSION`)
  Xcode projesinden gelir.

TestFlight işi için depo ayarlarında **Settings > Secrets and variables > Actions**
bölümüne şu gizli anahtarları ekleyin (eksikse iş uyarı verip atlanır):

| Secret | Değer |
| --- | --- |
| `APPLE_TEAM_ID` | Apple Developer hesabındaki 10 karakterlik Team ID |
| `APP_STORE_CONNECT_KEY_ID` | App Store Connect > Users and Access > Integrations > App Store Connect API'de oluşturulan anahtarın Key ID'si |
| `APP_STORE_CONNECT_ISSUER_ID` | Aynı sayfadaki Issuer ID |
| `APP_STORE_CONNECT_API_KEY_BASE64` | İndirilen `AuthKey_XXXX.p8` dosyasının base64 hâli: `base64 -i AuthKey_XXXX.p8 \| pbcopy` |
| `IOS_SIGNING_CERTIFICATE_BASE64` *(isteğe bağlı)* | Keychain'den dışa aktarılan Apple Distribution `.p12` dosyasının base64 hâli |
| `IOS_SIGNING_CERTIFICATE_PASSWORD` *(isteğe bağlı)* | `.p12` parolası |

API anahtarı **Admin** rolüyle oluşturulmalıdır; böylece Xcode otomatik imzalama App ID'leri,
App Group'u, sertifikaları ve provisioning profillerini kendisi oluşturup indirebilir.
`.p12` verilirse mevcut sertifikanız kullanılır. Yüklemeden önce App Store Connect'te
`com.hatirlaticilarim.app` Bundle ID'li uygulama kaydının oluşturulmuş olması gerekir.

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
