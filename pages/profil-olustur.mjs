// iPhone'a "profil" olarak kurulabilen Web Clip yapılandırma profillerini üretir.
// Kullanım: node pages/profil-olustur.mjs <site klasörü> <site adresi>
// Profil, Ayarlar > Profil İndirildi > Yükle ile kurulunca ana ekrana tam ekran açılan
// uygulama simgesi ekler; Ayarlar > Genel > VPN ve Aygıt Yönetimi'nden kaldırılabilir.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [siteDir, siteUrlArg] = process.argv.slice(2);
if (!siteDir || !siteUrlArg) {
  console.error('Kullanım: node pages/profil-olustur.mjs <site klasörü> <site adresi>');
  process.exit(1);
}
const siteUrl = siteUrlArg.endsWith('/') ? siteUrlArg : `${siteUrlArg}/`;

// UUID'ler sabittir: profil yeniden kurulunca eskisinin yerini alır, kopya oluşmaz.
const uygulamalar = [
  {
    klasor: 'hatirlaticilarim',
    ad: 'Hatırlatıcılarım',
    kimlik: 'io.github.volkandoyran.hatirlaticilarim',
    uuid: '6F3B2E1A-4C5D-4E8F-9A0B-1C2D3E4F5A61',
    profilUuid: '6F3B2E1A-4C5D-4E8F-9A0B-1C2D3E4F5A60',
  },
  {
    klasor: 'cevirilerim',
    ad: 'Çevirilerim',
    kimlik: 'io.github.volkandoyran.cevirilerim',
    uuid: '8A1C4D2B-7E6F-4A3B-8C9D-0E1F2A3B4C71',
    profilUuid: '8A1C4D2B-7E6F-4A3B-8C9D-0E1F2A3B4C70',
  },
];

const xml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function webClip(app) {
  const ikon = await readFile(path.join(siteDir, app.klasor, 'apple-touch-icon.png'));
  return `    <dict>
      <key>PayloadType</key><string>com.apple.webClip.managed</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>PayloadIdentifier</key><string>${app.kimlik}.webclip</string>
      <key>PayloadUUID</key><string>${app.uuid}</string>
      <key>PayloadDisplayName</key><string>${xml(app.ad)}</string>
      <key>Label</key><string>${xml(app.ad)}</string>
      <key>URL</key><string>${xml(siteUrl + app.klasor + '/')}</string>
      <key>Icon</key><data>${ikon.toString('base64')}</data>
      <key>FullScreen</key><true/>
      <key>IgnoreManifestScope</key><true/>
      <key>IsRemovable</key><true/>
      <key>Precomposed</key><true/>
    </dict>`;
}

function profil({ kimlik, uuid, ad, aciklama, icerik }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadVersion</key><integer>1</integer>
  <key>PayloadIdentifier</key><string>${kimlik}</string>
  <key>PayloadUUID</key><string>${uuid}</string>
  <key>PayloadDisplayName</key><string>${xml(ad)}</string>
  <key>PayloadDescription</key><string>${xml(aciklama)}</string>
  <key>PayloadOrganization</key><string>Uygulamalarım</string>
  <key>PayloadRemovalDisallowed</key><false/>
  <key>PayloadContent</key>
  <array>
${icerik.join('\n')}
  </array>
</dict>
</plist>
`;
}

const clipler = await Promise.all(uygulamalar.map(webClip));
for (const [i, app] of uygulamalar.entries()) {
  await writeFile(
    path.join(siteDir, `${app.klasor}.mobileconfig`),
    profil({
      kimlik: app.kimlik,
      uuid: app.profilUuid,
      ad: app.ad,
      aciklama: `${app.ad} uygulamasını ana ekrana ekler.`,
      icerik: [clipler[i]],
    })
  );
}
await writeFile(
  path.join(siteDir, 'uygulamalarim.mobileconfig'),
  profil({
    kimlik: 'io.github.volkandoyran.uygulamalarim',
    uuid: '2D4E6F80-91A2-4B3C-8D4E-5F60718293A0',
    ad: 'Uygulamalarım',
    aciklama: 'Hatırlatıcılarım ve Çevirilerim uygulamalarını ana ekrana ekler.',
    icerik: clipler,
  })
);
console.log('Profiller oluşturuldu:', siteDir);
