# Uygulamaları kendi iPhone'una kurma (App Store olmadan)

## Bilgisayarsız: web uygulaması olarak (önerilen)

İki uygulama ücretsiz GitHub Pages adresinde yayınlanır:

**https://volkandoyran.github.io/hatirlatici/**

1. Bu adresi iPhone'da **Safari** ile aç ve **İkisini birden kur**'a (ya da bir
   uygulamanın yanındaki **Kur**'a) dokun.
2. Profil indirme uyarısında **İzin Ver** > **Kapat**.
3. **Ayarlar**'ın en üstündeki **Profil İndirildi**'ye dokun (görünmezse
   *Ayarlar > Genel > VPN ve Aygıt Yönetimi*), **Yükle**'ye bas ve telefon parolanı gir.
4. Simgeler ana ekrana gelir.

Profil imzasız olduğu için iOS "Doğrulanmadı" yazar; bu beklenen bir durumdur. Profil
yalnızca ana ekrana uygulamaya giden tam ekran bir simge ekler, başka ayar değiştirmez ve
*VPN ve Aygıt Yönetimi*'nden kaldırılabilir. Profil istemezsen uygulamayı Safari'de açıp
**Paylaş > Ana Ekrana Ekle** de diyebilirsin.

Ana ekrandaki simgeler uygulamaları tam ekran açar. İlk açılıştan sonra internetsiz
de çalışırlar, süreleri dolmaz, Apple ID ya da bilgisayar gerekmez. Veriler yalnızca
telefonda saklanır. Yeni bir sürüm `main` dalına girdiğinde site kendiliğinden
güncellenir; uygulamayı açtığında yeni sürüm yüklenir.

Web sürümünün sınırları (iOS kısıtları):

- **Widget yok**: iOS, web uygulamalarına ana ekran ya da kilit ekranı widget'ı izni vermez.
- **Hatırlatma bildirimleri** yalnızca uygulama açıkken gelir. iOS web uygulamalarında
  zamanlanmış yerel bildirime izin vermez.
- Çevirilerim internet bağlantısı ister (çeviri MyMemory servisinden gelir).

Widget ve uygulama kapalıyken bildirim istersen yerel `.ipa` sürümü gerekir.
Aşağıdaki yöntem bunun için bir kez bilgisayar ister.

---

## Bilgisayarla: yerel `.ipa` sürümü

Bu yöntemde Hatırlatıcılarım ve Çevirilerim'in yerel (native) sürümleri ücretsiz
bir Apple ID ile kurulur. Mac gerekmez; Xcode derlemesini GitHub'ın macOS makinesi
yapar, kurulumu Windows'tan yaparsın.

## 1. Derlenmiş `.ipa` dosyasını indir

1. GitHub'da depoyu aç: **Actions > iOS Xcode Build**.
2. `main` dalındaki en son yeşil (✓) çalıştırmaya tıkla. Yeni bir derleme istersen
   sağ üstteki **Run workflow** düğmesiyle elle başlatabilirsin.
3. Sayfanın altındaki **Artifacts** bölümünden indir:
   - `hatirlatici-ios-…` → içinden `Hatirlaticilarim.ipa`
   - `ceviri-ios-…` → içinden `Cevirilerim.ipa`
4. İndirilen `.zip` dosyasını aç; içindeki `.ipa` dosyasını kullanacaksın.
   (`…-simulator.app.zip` yalnızca Mac'teki simülatör içindir, telefona kurulmaz.)

Artifacts 14 gün saklanır; süresi geçtiyse **Run workflow** ile yeniden derlet.

## 2. Windows'ta Sideloadly ile telefona kur

1. **iTunes** ve **iCloud**'u Apple'ın sitesinden indirip kur (Microsoft Store
   sürümleri değil; Sideloadly sitesindeki bağlantıları kullan).
2. **Sideloadly**'yi `sideloadly.io` adresinden indirip kur.
3. iPhone'u USB kabloyla bağla, telefonda **Bu bilgisayara güven**'e dokun.
4. Sideloadly'de:
   - `.ipa` dosyasını pencereye sürükle,
   - **Apple ID** alanına kendi Apple ID e-postanı yaz,
   - **Start**'a bas ve sorulursa Apple ID parolanı gir.
     İki adımlı doğrulama kodu gelirse onu da gir.
5. İkinci uygulama için aynı adımları tekrarla.

## 3. Telefonda ilk açılış

1. **Ayarlar > Gizlilik ve Güvenlik > Geliştirici Modu**'nu aç (iOS 16 ve sonrası).
   Telefon yeniden başlar; açılınca **Aç**'ı onayla.
2. **Ayarlar > Genel > VPN ve Aygıt Yönetimi**'nde kendi Apple ID'ne dokunup
   **Güven**'e bas.
3. Uygulamayı aç. Hatırlatıcılarım bildirim izni ister.
4. Widget için ana ekranda boş alana uzun bas, **+** ile **Sıradaki Hatırlatma**'yı ekle.

## 7 günlük süre ve yenileme

Ücretsiz Apple ID ile imzalanan uygulamalar **7 gün** çalışır; sonra açılmaz
(veriler silinmez). Yenilemek için:

- Sideloadly'de aynı `.ipa`'yı aynı Apple ID ile tekrar kur. Veriler korunur.
- Ya da Sideloadly'nin **otomatik yenileme** seçeneğini aç. Bilgisayar açıkken ve
  telefon aynı Wi-Fi ağındayken uygulamaları kendisi yeniler.

Ücretsiz hesapta aynı anda en fazla **3** yan yüklenmiş uygulama kullanılabilir.
Bu iki uygulama sığar.

> Yılda 99 $ olan Apple Developer Program üyeliği alırsan imza süresi 1 yıla çıkar.
> Kendi kullanımın için gerekmez.

## Alternatif: AltStore

AltStore (`altstore.io`) da aynı işi yapar; Windows'ta AltServer'ı kurup telefona
AltStore yüklersin. Sonra `.ipa` dosyalarını telefonda AltStore'dan açarsın ve
AltStore aynı Wi-Fi ağındayken uygulamaları kendisi yeniler. AltStore App Group
kimliğini kendi hesabına göre değiştirir. Uygulama ve widget bu değişikliği
(`ALTAppGroups`) otomatik algılar.

## Sorun giderme

- **"Untrusted Developer" / "Güvenilmeyen Geliştirici"**: 3. adımdaki
  *VPN ve Aygıt Yönetimi* onayını yap.
- **"Maximum number of apps"**: Ücretsiz hesapta 3 uygulama sınırı doldu.
  Telefonda başka bir yan yüklenmiş uygulamayı sil.
- **Widget boş kalıyor**: Uygulamayı bir kez açıp bir hatırlatma ekle. Widget'ın
  ne zaman yenileneceğine iOS karar verir.
- **Sideloadly "Your maximum App ID limit has been reached"**: Ücretsiz hesapta
  7 günde en fazla 10 App ID oluşturulabilir. Birkaç gün bekle ya da aynı uygulamayı
  yeniden kurarken başka bir Apple ID kullanma.
