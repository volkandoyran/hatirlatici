# İkili DNS (iOS)

Her DNS sorgusunu **Google (8.8.8.8)** ve **AdGuard (94.140.14.14)** sunucularına **aynı anda** gönderir.
Hangisi önce cevap verirse o kullanılır. Biri çökerse ya da yavaşlarsa diğeri işi devralır.
Birincil sunuculardan 1 saniyede cevap gelmezse ikinciler de devreye girer (8.8.4.4 ve 94.140.15.15).
**Wi‑Fi'da ve hücresel veride** çalışır.

## Nasıl çalışıyor?
Uygulama, yalnızca DNS trafiğini yakalayan yerel bir "VPN" (Packet Tunnel) kurar:
- iOS'a DNS sunucusu olarak tünel içindeki sanal `198.18.0.1` adresi verilir.
- Tünele sadece bu adres yönlendirilir. **İnternet trafiğiniz tünelden geçmez**, hız kaybı yaşanmaz.
- Uzantı her sorguyu iki sağlayıcıya paralel gönderir ve ilk gelen cevabı döndürür.
- "İsteğe bağlı bağlan" kuralı sayesinde ağ değişince (Wi‑Fi ↔ hücresel) tünel kendiliğinden açık kalır.
- Uygulama ekranında hangi sağlayıcının kaç kez önce cevap verdiği görünür.

## Telefona kurulum (Mac gerekmez)

Xcode derlemesini GitHub'ın macOS makinesi yapar.

1. GitHub'da **Actions > İkili DNS iOS Build** sayfasını açın. En son yeşil (✓) çalıştırmaya girin.
   Yeni derleme için **Run workflow** düğmesini kullanın.
2. **Artifacts** bölümünden `ikili-dns-ios-…` dosyasını indirin. İçinden `IkiliDNS.ipa` çıkar.
3. Windows'ta **Sideloadly** ile `.ipa` dosyasını telefona kurun.
   Adımlar, depo kökündeki `TELEFONA-KURULUM.md` dosyasındakiyle aynı.
4. Telefonda uygulamayı açın, **Aç**'a basın ve VPN yapılandırması iznini onaylayın.

> ⚠️ **Apple hesabı türü önemli.** Uygulama Network Extension (Packet Tunnel) yetkisi kullanıyor.
> Apple bu yetkiyi **ücretsiz Apple ID'lere vermiyor**. Ücretsiz hesapla kurulumda uygulama
> telefona yüklenir, fakat **Aç**'a basınca tünel başlamaz ve hata verir.
> Çalışması için Sideloadly'de **ücretli Apple Developer hesabı** (yıllık 99 $) kullanılmalı.

### Mac ile derlemek isterseniz
```bash
brew install xcodegen
cd ikili-dns
xcodegen generate
open IkiliDNS.xcodeproj
```
Sonra iki hedefte de *Signing & Capabilities* bölümünden takımınızı seçip iPhone'a çalıştırın.

## Doğrulama
- Uygulamada "Google" ve "AdGuard" satırlarındaki sayılar artmalı. Bu, ikisinin de aktif olarak cevap verdiğini gösterir.
- AdGuard reklam engellediği için bazı reklam alan adları engellenebilir. Hangi sunucu önce cevap verirse onun sonucu geçerli olur.
  Filtresiz AdGuard isterseniz `Shared/DNSConfig.swift` dosyasında `94.140.14.140` ve `94.140.14.141` adreslerini kullanın.

## Sınırlamalar
- Aynı anda başka bir VPN uygulaması kullanılamaz (iOS tek VPN'e izin veriyor).
- Kendi şifreli DNS'ini kullanan uygulamalar (ör. tarayıcıların "Güvenli DNS" ayarı) bu tüneli atlar.
- Sorgular upstream'e klasik UDP/53 ile gider (şifresiz). 1472 bayttan büyük cevaplar "kesildi" (TC) işaretiyle döner.
  Bu çok nadir görülen bir durumdur.
