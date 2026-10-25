# Hatırlatıcılarım — Türkçe Kod Açıklamaları

Bu klasör, uygulamanın mantığı Türkçe yorumlarla açıklanmış ikinci kopyasını içerir.
Asıl uygulama dosyalarına ve `yedek/orijinal` içindeki yedeğe dokunulmamıştır.

## Dosyalar

- `index.html`: Uygulama açıklamasını, tek açılır menü içindeki gruplu bölüm
  bağlantılarını, birbirinden ayrı sayfa panellerini, form ve ayarları tanımlar.
- `style.css`: Renkleri, kartları, açık/koyu temayı ve farklı ekran boyutlarındaki
  yerleşimi belirler. Görsel ayarlar CSS değişkenleri üzerinden ortaklaştırılmıştır.
- `script.js`: Hatırlatmaları ve ayarları yönetir; form, süzgeç, arama, tekrar,
  bildirim ve özel alarm davranışlarını yürütür.
- `manifest.webmanifest`: Ana ekrana ekleme adını, simgeleri, başlangıç adresini ve
  uygulama penceresi görünümünü bildirir.
- `service-worker.js`: Temel uygulama dosyalarını önbelleğe alır; daha önce açılmış
  uygulamanın internet bağlantısı yokken yüklenmesine yardımcı olur.
- `package.json` ve `capacitor.config.json`: Vite derleme komutlarını, Capacitor
  bağımlılıklarını, iOS uygulama kimliğini ve yerel bildirim eklentisini tanımlar.
- `vite.config.js`: Üretilen web paketine service worker dosyasını ekler.
- `native/widget-bridge/`: Capacitor uygulamasından App Group paylaşımlı depoya
  hatırlatma verilerini aktaran yerel iOS eklentisini içerir.
- `ios-widget/HatirlaticilarimWidget.swift`: Ana ekran ve kilit ekranı WidgetKit
  arayüzlerini ve widget zaman çizelgesini tanımlar.
- `ios-widget/*.entitlements`: Uygulama ve widget uzantısının aynı App Group'u
  paylaşabilmesi için yetki örneklerini içerir.
- `APP-STORE-HAZIRLIK.md`: Mac/Xcode kurulumu, imzalama ve App Store yayın kontrol
  listesini, widget kurulum adımlarını ve mağaza açıklaması taslağını içerir.
- `README.md`: Proje tanıtımını, çalıştırma/derleme adımlarını, iOS gereksinimlerini
  ve yedek düzenini özetler; açıklamanın sonunda yapay zekâ desteği beyan edilir.
- `app-icon.svg` ve `apple-touch-icon.png`: Tarayıcı sekmesi ve iPhone ana ekranı
  için uygulama simgeleridir.

## Uygulamanın veri akışı

1. Sayfa açılınca `script.js`, `localStorage` içindeki hatırlatma ve tercih kayıtlarını
   yükler. İlk çalıştırmada örnek hatırlatmalar gösterilir.
2. Form gönderildiğinde başlık, not, tarih, saat, kategori ve öncelik okunur. Tarih
   ile saat yerel saate göre tek bir tarih değerine dönüştürülür.
3. Yeni hatırlatma eklenir veya düzenlenen kayıt aynı kimlikle güncellenir. Liste
   kaydedildikten sonra ekrandaki kartlar ve sayaçlar yeniden çizilir.
4. Süzgeç ve arama, saklanan kayıtları değiştirmez; sadece o anda gösterilecek
   kayıtları seçer.
5. Tamamlanan tekrarlı bir hatırlatma, tekrar kuralına göre ileri taşınır. Tekrar
   sayısı sınırı veya bitiş tarihi dolmuşsa kayıt tamamlanmış olarak kalır.
6. Zamanlayıcı 30 saniyede bir bildirim aşamalarını ve yaklaşan zamanı kontrol eder.
   Hatırlatma için 1 gün, 1 saat, 30 dakika, 10 dakika ve 5 dakika önce, ayrıca
   vaktinde bildirim oluşturulur. Uygulama açılırken geçmiş uyarı eşikleri
   `getElapsedLeadStages` ile tüketilmiş işaretlenir; böylece eski bir “1 saat kaldı”
   bildirimi geç kalmış halde gönderilmez. Tarayıcı bildirimleri yalnızca uygulama
   açıkken kontrol edilir; özel ses ayarı açıksa seçilen ses dosyası çalar.
7. Web sürümünde service worker yalnızca güvenli kaynakta (HTTPS veya `localhost`) kaydedilir;
   kaynak dosyalar değiştiğinde `service-worker.js` içindeki önbellek sürümü artırılır.
8. Capacitor iOS uygulamasında hatırlatmalar yerel depoda tutulur. Kullanıcı izin
   verdiğinde en yakın 64 gelecek bildirim aşaması iOS yerel bildirimi olarak planlanır;
   kayıt ekleme, düzenleme veya silmede bildirim kuyruğu eşitlenir.
9. Menü yalnızca bölüm bağlantılarını açıp kapatır; seçilen sayfa menünün dışında
   gösterilir. Menü kapanınca sayfa görünür kalır, menü yeniden açılınca seçilen
   bölüm bilgisi korunur.
10. Capacitor iOS kabuğunda hatırlatma listesi özel WidgetBridge eklentisiyle App
    Group deposuna aktarılır. Ekleme, düzenleme ve silmede WidgetKit zaman çizelgesi
    yenilenir; web/PWA kullanımında yerel eklenti çağrılmaz.
11. Bildirim izni istenmeden önce `showPermissionExplanation`, iznin neden
    gerektiğini anlatan yerel bir açıklama penceresi açar. Yalnızca kullanıcı
    **Devam et** derse iOS/tarayıcı izin API'si çağrılır; **Şimdi değil** seçimi
    isteği iptal eder. Uygulama iPhone Ayarlar'ını kendiliğinden açmaz veya
    değiştirmez. Yeni sistem izinleri de aynı açıklama-onay akışından geçirilmelidir.
12. Alarm dosyası seçicisi de açılmadan önce aynı açıklama penceresini kullanır.
    Onay verilirse kullanıcı dosya seçiciye geçer; uygulama sadece seçilen ses
    dosyasını okur, fotoğraf arşivine erişmez. Yeni cihaz verisi/izin akışları
    açıklama ve kullanıcı onayı olmadan başlatılmamalıdır.

## İsteğe bağlı tekrar ayarları

- **Tekrarlama sıklığı:** Tekrarlanmasın, günlük, hafta içi, haftalık veya aylık.
- **Aralık:** Örneğin 2 seçilirse iki günde/iş gününde/haftada/ayda bir.
- **Bitiş:** Süresiz, belirli sayıda ek tekrar veya bitiş tarihi.
- Aylık tekrar, hedef ayda aynı gün yoksa ayın son gününü kullanır (örneğin 31 Ocak
  sonrasındaki aylık tekrar şubatın son günü olur).
- Bitiş sayısı seçildiğinde belirtilen sayı, ilk tarihten sonraki ek tekrar adedidir.
- Bu alanlar zorunlu değildir; tekrar kapalıysa kullanılmaz, bitiş tercihi boşsa
  tekrar süresiz devam eder.

## Özel alarm ve tarayıcı sınırlamaları

- Yalnızca ses türü `audio/` olan ve en fazla 1 MB boyutundaki dosyalar kabul edilir.
- Ses dosyası ve ses düzeyi bu tarayıcının yerel deposunda saklanır; başka cihaza
  otomatik aktarılmaz.
- Tarayıcıların otomatik ses çalmayı kısıtlaması nedeniyle ilk kullanımda **Alarmı
  dene** düğmesine basmak gerekir.
- Bu basit web uygulaması arka planda çalışan bir servis değildir. Alarm kontrolü
  uygulama sayfası açıkken yapılır; sekme kapalıysa veya tarayıcı durdurulmuşsa
  zamanında çalma garanti edilmez.

## iPhone ve iPad kullanımı

- Uygulama, `manifest.webmanifest` ve service worker ile aşamalı web uygulaması (PWA)
  olarak ana ekrana eklenebilir. Bunun için HTTPS gerekir; yerel geliştirmede
  `localhost` güvenli kabul edilir.
- iPhone'da uygulamayı HTTPS adresinde Safari ile açın, **Paylaş** düğmesine ve
  ardından **Ana Ekrana Ekle** seçeneğine dokunun. Ana ekran simgesi PNG biçimindeki
  `apple-touch-icon.png` dosyasını kullanır.
- Ana ekrandaki simgeden açıldığında uygulama bağımsız pencere görünümüne geçer.
  Bir kez çevrimiçiyken açılmış temel dosyalar service worker önbelleğinden çevrimdışı
  yüklenebilir. Hatırlatmalar ve tercihler cihazın yerel tarayıcı deposunda kalır.
- Çentik ve ana ekran göstergesi çevresindeki güvenli boşluklar CSS
  `env(safe-area-inset-*)` değerleriyle korunur. Form yazı boyutu 16 piksel tutularak
  iOS Safari'nin odaklanırken otomatik yakınlaştırması önlenir.
- iOS/iPadOS'ta ana ekran web uygulamalarına tarayıcı bildirimi için iOS/iPadOS 16.4
  veya üzeri gerekir; uygulama ana ekrana eklenmiş olmalı ve kullanıcı izin vermelidir.
- Özel ses alarmı iOS'ta yalnızca uygulama açık ve etkin durumdayken çalabilir.
  Service worker sayfayı önbelleğe alır fakat kapalı uygulamada ses alarmı veya kesin
  zamanlı arka plan görevi çalıştıramaz.

## App Store için Capacitor paketi

- `npm run build`, web uygulamasını `dist/` içine derler; `npm run ios:add` iOS
  Xcode projesini oluşturur; `npm run ios:sync` kaynakları ve eklentileri eşitler.
- `npm run ios:open`, üretilen projeyi Xcode'da açar. iOS derleme, imzalama ve
  App Store yüklemesi için Mac ve Apple Developer hesabı gerekir.
- Capacitor iOS projesi `ios/` içinde tutulur; Windows'ta `npm run ios:add` ile
  oluşturulabilir ve `npm run ios:sync` ile güncel web dosyalarıyla eşitlenebilir.
  Xcode, CocoaPods ve gerçek iPhone/simülatör doğrulaması macOS gerektirir.
- `APP-STORE-HAZIRLIK.md`, bu bilgisayarda iOS kabuğunun oluşturulup eşitlendiğini
  ve Xcode derlemesi için gereken Mac tarafındaki kalan adımları açıklar.
- Uygulama menüsü iOS ekranında tek bir açılır menü olarak gösterilir. İçinde
  “Planlama” ve “Kişiselleştirme” grupları, onların altında bölüm bağlantıları bulunur.
  Bir bölümü seçince menü kapanır; seçilen içerik görünür kalır. Menü yeniden
  açıldığında bölüm grupları ve mevcut seçim korunur.
- iOS yerel bildirimleri işletim sistemi sesi kullanır. Kullanıcı tarafından seçilen
  ses dosyası yerel bildirim paketine eklenmez; uygulama açıkken özel ses çalabilir.
- Yerel bildirim kuyruğu, hatırlatma başına 1 gün, 1 saat, 30 dakika, 10 dakika,
  5 dakika ve vaktinde olmak üzere altı bildirim aşaması kullanır. iOS toplamda en
  fazla 64 bildirim bekletebildiğinden
  çok hatırlatma varsa tüm uyarı aşamaları sıraya alınamayabilir. Tekrarlı hatırlatmanın
  bir sonraki zamanı tamamlandığında planlanır; uygulama kapalıyken tekrar bildirimi
  teslim edildikten sonra yeni tekrar uygulama yeniden açılana kadar planlanmayabilir.
- Ana ekran widget'ı sıradaki hatırlatma ile bugünkü bekleyen sayısını, kilit ekranı
  widget'ları sıradaki başlık ve saati gösterir. Kilit ekranında başlık başkalarınca
  görülebilir. Widget yenileme zamanlamasını iOS belirler ve gecikme olabilir.
- App Group'un `group.com.hatirlaticilarim.app` kimliği hem ana uygulama hem WidgetKit
  uzantısının imza/yetki ayarlarında etkinleştirilmelidir. Xcode'da ayrıca Widget
  Extension hedefi oluşturup `ios-widget/HatirlaticilarimWidget.swift` dosyasını bu
  hedefe eklemek gerekir.
- iOS 26 ve üzeri widget'larda Liquid Glass yüzeyini sistem sağlar; eski sürümlerde
  uyumlu standart widget/material görünümü kullanılır.
- Ana ekrandaki açıklama, kayıtların cihazda saklandığını belirtir; uygulama
  cihazlar arası bulut eşitlemesi veya otomatik yedekleme yapmaz.
- Bu yapı App Store onayını garanti etmez. Yayına çıkmadan önce gerçek cihazlarda
  test, gizlilik açıklaması, mağaza görselleri ve Apple inceleme gereksinimleri
  tamamlanmalıdır. Ayrıntılı adımlar `APP-STORE-HAZIRLIK.md` dosyasındadır.
- Safari/PWA'da tutulan kayıtlar ile Capacitor uygulamasındaki kayıt alanı farklıdır;
  mevcut hatırlatmalar yeni uygulamaya otomatik taşınmaz.

## Yedeklerin anlamı

- `../orijinal/`: Değişiklik öncesi mevcut uygulama ve yapılandırma dosyalarının
  yorum eklenmemiş, birebir kopyalarını içerir.
- Bu klasördeki `index.html`, `style.css` ve `script.js`: Mantığı Türkçe açıklayan
  yorumlar eklenmiş kopyalardır. Çalışan uygulamanın yerine geçmez ve asıl dosyaları
  değiştirmez. PWA kaynakları da açıklamalı klasörde bulunur; yeni eklenen kaynakların
  değişiklik öncesi sürümü olmadığı için orijinal yedekte karşılığı bulunmayabilir.

## Gelecek değişikliklerde izlenecek yedekleme düzeni

Hatırlatıcı uygulamasının kodu ileride değiştirilirken:

1. Değişiklikten önce çalışan uygulamanın o tarihte var olan dosyaları
   (`index.html`, `style.css`, `script.js`, PWA kaynakları, Capacitor eklentileri,
   WidgetKit kaynakları ve varsa yapılandırma dosyaları) `../orijinal/` klasörüne
   kopyalanır; bu klasör değişiklik öncesi sürümü saklar.
2. Değişiklik tamamlandıktan sonra güncel uygulama dosyaları
   (`index.html`, `style.css`, `script.js` ve varsa manifest, service worker, simge,
   paket/yapılandırma, yerel Swift eklentisi, WidgetKit kaynağı ve yayın belgeleri
   gibi ek dosyalar) `../aciklamali/` klasörüne kopyalanır. Kod dosyalarına Türkçe
   mantık açıklamaları eklenir.
3. `ACIKLAMALAR.md`, yeni özelliklerin davranışını ve önemli sınırlamalarını
   açıklayacak şekilde güncellenir.
4. Yedek kopyaları doğrulanır; çalışan uygulamanın dosyaları açıklamalı kopyayla
   değiştirilmez. Henüz var olmayan yeni bir dosyanın değişiklik öncesi sürümü
   bulunmadığından, ilk kez eklenen dosya için orijinal kopya oluşturulmaz.
