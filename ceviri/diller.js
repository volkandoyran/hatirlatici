// Uygulamada seçilebilen diller ve dil kodu yardımcıları.
// Kodlar MyMemory'nin kabul ettiği ISO 639-1 / RFC 3066 biçimindedir.

export const AUTO_LANGUAGE = 'auto';

// common: seçim kutusunda "Sık kullanılan" grubunda en üstte gösterilir.
export const LANGUAGES = [
  { code: 'tr', name: 'Türkçe', common: true },
  { code: 'en', name: 'İngilizce', common: true },
  { code: 'de', name: 'Almanca', common: true },
  { code: 'fr', name: 'Fransızca', common: true },
  { code: 'es', name: 'İspanyolca', common: true },
  { code: 'ar', name: 'Arapça', common: true },
  { code: 'ru', name: 'Rusça', common: true },
  { code: 'sq', name: 'Arnavutça' },
  { code: 'az', name: 'Azerbaycanca' },
  { code: 'bs', name: 'Boşnakça' },
  { code: 'bg', name: 'Bulgarca' },
  { code: 'cs', name: 'Çekçe' },
  { code: 'zh-CN', name: 'Çince (Basitleştirilmiş)' },
  { code: 'zh-TW', name: 'Çince (Geleneksel)' },
  { code: 'da', name: 'Danca' },
  { code: 'id', name: 'Endonezce' },
  { code: 'fa', name: 'Farsça' },
  { code: 'fi', name: 'Fince' },
  { code: 'ka', name: 'Gürcüce' },
  { code: 'hi', name: 'Hintçe' },
  { code: 'hr', name: 'Hırvatça' },
  { code: 'nl', name: 'Hollandaca' },
  { code: 'he', name: 'İbranice' },
  { code: 'sv', name: 'İsveççe' },
  { code: 'it', name: 'İtalyanca' },
  { code: 'ja', name: 'Japonca' },
  { code: 'kk', name: 'Kazakça' },
  { code: 'ko', name: 'Korece' },
  { code: 'pl', name: 'Lehçe' },
  { code: 'hu', name: 'Macarca' },
  { code: 'ms', name: 'Malayca' },
  { code: 'no', name: 'Norveççe' },
  { code: 'uz', name: 'Özbekçe' },
  { code: 'pt', name: 'Portekizce' },
  { code: 'ro', name: 'Romence' },
  { code: 'sr', name: 'Sırpça' },
  { code: 'th', name: 'Tayca' },
  { code: 'uk', name: 'Ukraynaca' },
  { code: 'ur', name: 'Urduca' },
  { code: 'vi', name: 'Vietnamca' },
  { code: 'el', name: 'Yunanca' },
];

const LANGUAGE_BY_CODE = new Map(LANGUAGES.map((language) => [language.code.toLowerCase(), language]));

// Sağdan sola yazılan diller; metin alanlarının yönü buna göre ayarlanır.
const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ur']);

// Servislerin döndürebildiği eş anlamlı kodlar listedeki koda çevrilir.
const LANGUAGE_ALIASES = new Map([
  ['zh', 'zh-CN'],
  ['zh-hans', 'zh-CN'],
  ['zh-sg', 'zh-CN'],
  ['zh-hant', 'zh-TW'],
  ['zh-hk', 'zh-TW'],
  ['zh-mo', 'zh-TW'],
  ['nb', 'no'],
  ['nn', 'no'],
  ['iw', 'he'],
  ['in', 'id'],
]);

/**
 * "de-DE", "EN", "zh-Hant" gibi kodları listedeki kodlardan birine eşler.
 * Listede karşılığı yoksa null döner.
 */
export function normalizeLanguageCode(code) {
  if (typeof code !== 'string' || !code.trim()) {
    return null;
  }
  const lower = code.trim().replace(/_/g, '-').toLowerCase();
  const exact = LANGUAGE_BY_CODE.get(lower) ?? LANGUAGE_BY_CODE.get(LANGUAGE_ALIASES.get(lower)?.toLowerCase());
  if (exact) {
    return exact.code;
  }

  const [primary, ...rest] = lower.split('-');
  // "zh-Hant-TW" gibi üç parçalı kodlar için yazı sistemi alt etiketi de denenir.
  for (const candidate of [`${primary}-${rest[0] ?? ''}`, primary]) {
    const alias = LANGUAGE_ALIASES.get(candidate);
    const match = LANGUAGE_BY_CODE.get(alias?.toLowerCase() ?? candidate);
    if (match) {
      return match.code;
    }
  }
  return null;
}

function primarySubtag(code) {
  return String(code).toLowerCase().split(/[-_]/)[0];
}

/** İki kodun aynı dili gösterip göstermediğini söyler; Çincenin iki yazımı ayrı sayılır. */
export function sameLanguage(first, second) {
  if (!first || !second) {
    return false;
  }
  const firstCode = normalizeLanguageCode(first) ?? first;
  const secondCode = normalizeLanguageCode(second) ?? second;
  if (firstCode.toLowerCase().startsWith('zh') && secondCode.toLowerCase().startsWith('zh')) {
    return firstCode.toLowerCase() === secondCode.toLowerCase();
  }
  return primarySubtag(firstCode) === primarySubtag(secondCode);
}

export function getLanguageName(code) {
  if (code === AUTO_LANGUAGE) {
    return 'Dili algıla';
  }
  const normalized = normalizeLanguageCode(code);
  return normalized ? LANGUAGE_BY_CODE.get(normalized.toLowerCase()).name : String(code);
}

export function isRtl(code) {
  return Boolean(code) && RTL_LANGUAGES.has(primarySubtag(code));
}

export function isSupportedLanguage(code) {
  return typeof code === 'string' && LANGUAGE_BY_CODE.has(code.toLowerCase());
}

/** Tarayıcının cihaz içi çeviri (Translator) API'si BCP 47 kodları bekler. */
export function toDeviceLanguage(code) {
  if (code === 'zh-CN') {
    return 'zh';
  }
  if (code === 'zh-TW') {
    return 'zh-Hant';
  }
  return code;
}
