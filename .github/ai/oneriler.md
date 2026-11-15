# Yapay zekâ özellik önerileri (derlenmiş)

Kaynak: `.github/workflows/ai-fikirler.yml` ile ücretsiz servislere sorulan
`.github/ai/istem.md` istemi (Pollinations · openai, iki çalıştırma). GitHub Models bu
hesapta boş yanıt döndürdü; GitHub'da **Settings > Models** etkinleştirilirse iş akışı
oradaki modellere de sorar. Tekrarlanan ve konsepte uymayan (harita, e-posta, QR) fikirler
elendi; kalanlar değere göre sıralandı.

| # | Özellik | Açıklama | Web (PWA) | Zorluk |
|---|---------|----------|-----------|--------|
| 1 | Erteleme | Bildirim/hatırlatmada 5 · 15 · 30 dk veya "yarın" ertele düğmeleri; yerel sürümde bildirim eylemi olarak | Evet (uygulama içi) | Kolay |
| 2 | Hızlı ekleme | Tek satırdan ekleme ("yarın 9'da su faturası"), ana ekran kısayolu | Evet | Orta |
| 3 | Kategori renkleri | Her kategoriye renk; listede ve widget'ta renkli şerit | Evet | Kolay |
| 4 | Haftalık özet / istatistik | Tamamlanan, kaçırılan ve geciken işler; seri (streak) | Evet | Orta |
| 5 | Sesli not | Hatırlatmaya kısa ses kaydı ekleme (cihazda saklanır) | Evet | Orta |
| 6 | Koleksiyon / proje | Hatırlatmaları gruplayıp topluca tamamlama veya erteleme | Evet | Orta |
| 7 | Hazır tekrar şablonları | "Her ayın 1'i", "2 haftada bir" gibi tek dokunuşla seçilen desenler | Evet | Kolay |

## Widget önerileri

- Öncelik sıralı 2–3 hatırlatma listesi ve "kalan N" sayısı → **yapıldı** (orta boy widget)
- Öncelik/kategori renkli şerit → **öncelik rengi yapıldı**, kategori rengi 3. özellikle gelir
- Bugünkü bekleyen sayısı simge + sayı → **yapıldı** (kilit ekranı yuvarlak widget)
- Widget'tan "Yeni hatırlatma" düğmesi → iOS 17 etkileşimli widget ile mümkün (yerel sürüm)
