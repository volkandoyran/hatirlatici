# Donanım Teşhis Aracı

Windows'u açılmayan, ama **BIOS ayarlarına** ve **Windows kurulum ekranına**
girebilen bir bilgisayarda arızalı parçayı bulmak için hazırlanmış araç.

Windows kurulum USB'sinin içindeki komut isteminde çalışır. PowerShell, .NET
ya da kurulum gerektirmez. **Diske hiçbir şey yazmaz**, yalnızca okur ve test
eder. Sonuçları USB'deki `raporlar` klasörüne bir metin dosyası olarak kaydeder.

## Neleri kontrol eder?

| Test | Neyi bulur |
|---|---|
| Sistem bilgisi | Anakart, BIOS sürümü, RAM yuvaları. Takılı olup BIOS'un görmediği RAM modülü |
| Disk sağlığı (SMART) | SATA ve NVMe disklerde bozuk sektör, okunamayan sektör, SSD ömrü, sıcaklık, **SATA kablo hatası** |
| Disk yüzey testi | Okunamayan ya da çok yavaş okunan bölgeler (Windows'un takılıp açılmamasının en sık nedeni) |
| RAM testi | Boş belleğin tamamına 5 farklı desen yazıp geri okur |
| İşlemci stres testi | Tüm çekirdeklerde hesap hatası, ısınınca yavaşlama (soğutma sorunu), yük altında kapanma (güç kaynağı) |
| Windows kontrolü | Mavi ekran dökümlerini çözer (hangi parçayı işaret ettiğini söyler), olay günlüğündeki disk ve WHEA donanım hataları, Başlangıç Onarma kaydı, eksik ya da bozuk sistem dosyaları |
| Önyükleme kontrolü | EFI bölümü, BCD kaydı, UEFI/Legacy ayarı ile disk türünün uyuşmaması (CMOS pili bitip BIOS ayarları sıfırlanınca sık görülür) |

Sonunda **"SONUÇ: OLASI ARIZALI PARÇALAR"** başlığı altında parçaları
`ARIZALI / ÇOK OLASI` ve `ŞÜPHELİ` diye sıralar. Her parça için ne yapmanız
gerektiğini de yazar.

> Test sırasında bilgisayar kapanırsa ya da donarsa, aracı yeniden
> çalıştırdığınızda hangi testte kapandığını söyler. Örneğin işlemci testinde
> kapanma, güç kaynağına veya soğutmaya işaret eder.

## Hazırlık (çalışan başka bir bilgisayarda)

1. Microsoft'un **Media Creation Tool** aracıyla bir Windows 10 ya da 11 kurulum
   USB'si hazırlayın. Elinizde zaten bir kurulum USB'si varsa onu kullanabilirsiniz.
2. Bu `donanim-teshis` klasörünü, içindekilerle birlikte, USB'nin **kök dizinine**
   kopyalayın. Sonuç `E:\donanim-teshis\teshis.exe` gibi görünmeli.
   - Gerekli dosyalar: `teshis.exe`, `BASLAT.bat`, `OTOMATIK.bat`

## Kullanım (arızalı bilgisayarda)

1. USB'yi takın ve bilgisayarı USB'den açın. Açılış menüsü genelde
   **F12, F11, F8 ya da Esc** tuşuyla gelir.
2. Windows Kurulum ekranı (dil seçimi) geldiğinde **Shift + F10** tuşlarına
   basın. Siyah bir komut penceresi açılır.
   - Dizüstü bilgisayarlarda **Shift + Fn + F10** gerekebilir.
   - Olmazsa: *İleri → Bilgisayarınızı onarın → Sorun Gider → Komut İstemi*
3. Komut penceresine aşağıdaki satırı **aynen** yazıp Enter'a basın. Bu satır
   USB'nin hangi harfi aldığını kendisi bulur ve aracı başlatır:

   ```
   for %i in (C D E F G H I J K L M N O P) do @if exist %i:\donanim-teshis\teshis.exe %i:\donanim-teshis\BASLAT.bat
   ```

4. Menüden **1 (OTOMATİK TAM KONTROL)** seçeneğini seçin. Tüm testler 10-20
   dakika sürer. İsterseniz testleri menüden tek tek de çalıştırabilirsiniz.
5. Sonuç ekranda görünür ve USB'deki
   `donanim-teshis\raporlar\rapor_TARIH.txt` dosyasına kaydedilir. Bu dosyayı
   başka bir bilgisayarda açabilir ya da birine gönderebilirsiniz. Menüde
   **R** tuşu raporu Not Defteri'nde açar.

Uzun testlerde **ESC** tuşu testi durdurur.

## Sonuçları yorumlama

| Bulgu | Muhtemel parça | Ne yapmalı |
|---|---|---|
| Disk okuma hatası, bekleyen ya da yeniden atanmış sektör, NVMe medya hatası | **Disk** | Verileri kurtarın ve diski değiştirin |
| UDMA CRC hatası | **SATA kablosu / port** | Kabloyu değiştirin ya da başka bir porta takın |
| RAM testinde hata | **RAM** | Modülleri tek tek takıp test edin. XMP/EXPO açıksa kapatın |
| Takılı RAM'in tamamı görünmüyor | **RAM modülü ya da yuvası** | Modülleri farklı yuvalarda deneyin |
| İşlemci testinde hesap hatası, WHEA hatası | **İşlemci / anakart / güç** | BIOS'u varsayılan ayarlara alın, hız aşırtmayı kapatın |
| İşlemci testinde kapanma ya da yeniden başlama | **Güç kaynağı / soğutma** | PSU, fan, termal macun ve toz kontrolü |
| Isınınca hızın %30'dan fazla düşmesi | **Soğutma** | Fanı, soğutucuyu ve termal macunu kontrol edin |
| WATCHDOG raporu, VIDEO_TDR mavi ekranı | **Ekran kartı** | Kartı çıkarıp dahili grafikle deneyin |
| BCD veya EFI eksik, kritik dosya bozuk | **Windows (yazılım)** | `bcdboot C:\Windows`, Başlangıç Onarma ya da temiz kurulum |
| GPT disk + Legacy mod (ya da MBR + UEFI) | **BIOS ayarı** | BIOS'ta önyükleme modunu düzeltin, CMOS pilini değiştirin |
| Hiçbir donanım sorunu yok | Büyük olasılıkla **yazılım** | Başlangıç Onarma, güncellemeleri kaldırma, Sistem Geri Yükleme |

### Sınırlamalar

- **Güç kaynağı** ve **ekran kartı** doğrudan ölçülemez. Yalnızca dolaylı
  belirtilerden (yük altında kapanma, TDR kayıtları) tahmin edilir.
- RAM testi, kurulum ortamının kullandığı küçük bir bölüm dışındaki belleği
  test eder. Kesin sonuç için RAM'leri tek tek takarak deneyin ya da MemTest86 kullanın.
- Disk **BitLocker** ile şifreliyse Windows kayıtları okunamaz. Disk, RAM ve
  işlemci testleri yine de çalışır.
- Sıcaklık değerleri yalnızca anakart ACPI üzerinden bildiriyorsa görünür.
  Disk sıcaklığı SMART üzerinden her zaman okunur.

## Kaynaktan derleme

Kaynak kod `kaynak/teshis.c` dosyasında, tek dosya halinde.

```sh
# Linux (Debian/Ubuntu): sudo apt install gcc-mingw-w64-x86-64
sh kaynak/derle.sh
```

Windows'ta MSYS2/MinGW ile:
`gcc -O2 -municode -static -s -o teshis.exe kaynak/teshis.c -lsetupapi`
