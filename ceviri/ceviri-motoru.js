// Çeviri motoru: metni parçalara böler; önce (varsa) tarayıcının cihaz içi çevirmenini,
// yoksa MyMemory çevrimiçi çeviri servisini kullanır. Geçmiş ve günlük kota yardımcıları da
// buradadır. Bu dosya DOM kullanmaz; Node testlerinde doğrudan çalışır.
import { AUTO_LANGUAGE, normalizeLanguageCode, sameLanguage, toDeviceLanguage } from './diller.js';

export { AUTO_LANGUAGE };

export const MYMEMORY_ENDPOINT = 'https://api.mymemory.translated.net/get';
// MyMemory tek istekte en fazla 500 bayt (UTF-8) kabul eder.
export const MAX_SEGMENT_BYTES = 500;
// Anahtarsız günlük kota kadar; daha uzun metin tek seferde kotayı tüketir.
export const MAX_INPUT_CHARS = 5000;
export const DAILY_LIMIT_ANONYMOUS = 5000;
export const DAILY_LIMIT_WITH_EMAIL = 50000;
export const REQUEST_TIMEOUT_MS = 15000;
export const MAX_HISTORY_ENTRIES = 200;

export class TranslationError extends Error {
  constructor(code, message = '', options) {
    super(message || code, options);
    this.name = 'TranslationError';
    this.code = code;
  }
}

const ERROR_MESSAGES = {
  empty: 'Çevrilecek bir metin yazın.',
  'same-language': 'Kaynak ve hedef dil aynı. Farklı bir hedef dil seçin.',
  'too-long': `Metin çok uzun. Tek seferde en fazla ${MAX_INPUT_CHARS.toLocaleString('tr-TR')} karakter çevrilebilir.`,
  offline: 'İnternet bağlantısı yok. Çevrimiçi çeviri için bağlantınızı kontrol edin.',
  network: 'Çeviri servisine ulaşılamadı. Bağlantınızı kontrol edip yeniden deneyin.',
  timeout: 'Çeviri servisi zamanında yanıt vermedi. Biraz sonra yeniden deneyin.',
  quota: 'Günlük ücretsiz çeviri kotası doldu. Ayarlar bölümünden e-posta ekleyerek kotayı artırabilir ya da yarın yeniden deneyebilirsiniz.',
  language: 'Çeviri servisi bu dil çiftini desteklemiyor. Başka bir dil seçin.',
  service: 'Çeviri servisi beklenmeyen bir yanıt verdi. Biraz sonra yeniden deneyin.',
  aborted: 'Çeviri iptal edildi.',
  consent: 'Çeviri yapılmadı; metniniz hiçbir yere gönderilmedi.',
};

export function describeError(error) {
  if (error instanceof TranslationError && ERROR_MESSAGES[error.code]) {
    return ERROR_MESSAGES[error.code];
  }
  return 'Çeviri yapılamadı. Biraz sonra yeniden deneyin.';
}

const encoder = new TextEncoder();

export function byteLength(text) {
  return encoder.encode(text).length;
}

export function countCharacters(text) {
  return Array.from(text).length;
}

// Cümle sonu: nokta/ünlem/soru (+ kapanış tırnağı/parantez) ve ardından boşluk;
// Çince/Japonca tam genişlikli işaretlerden sonra boşluk gerekmez.
const SENTENCE_END = /[.!?…]+["'”’»)\]]*\s+|[。！？]+/gu;

// Metni hiçbir karakteri kaybetmeden cümlelere ayırır (lookbehind kullanılmaz;
// iOS 16.0-16.3 Safari'si bu sözdizimini desteklemez).
function splitSentences(text) {
  const pieces = [];
  let start = 0;
  for (const match of text.matchAll(SENTENCE_END)) {
    const end = match.index + match[0].length;
    pieces.push(text.slice(start, end));
    start = end;
  }
  if (start < text.length) {
    pieces.push(text.slice(start));
  }
  return pieces;
}

// Parçaları sırayla birleştirip bayt sınırını aşmayan gruplar oluşturur; sınırı tek başına
// aşan parça splitOversized ile daha küçük parçalara bölünür.
function packPieces(pieces, maxBytes, splitOversized) {
  const segments = [];
  let current = '';
  for (const piece of pieces) {
    if (byteLength((current + piece).trim()) <= maxBytes) {
      current += piece;
      continue;
    }
    if (current.trim()) {
      segments.push(current.trim());
    }
    current = '';
    if (byteLength(piece.trim()) <= maxBytes) {
      current = piece;
    } else {
      segments.push(...splitOversized(piece));
    }
  }
  if (current.trim()) {
    segments.push(current.trim());
  }
  return segments;
}

/**
 * Tek satırlık metni servis sınırına uyan parçalara böler: önce cümle, sonra kelime,
 * en son karakter sınırından.
 */
export function splitIntoSegments(text, maxBytes = MAX_SEGMENT_BYTES) {
  const clean = text.trim();
  if (!clean) {
    return [];
  }
  if (byteLength(clean) <= maxBytes) {
    return [clean];
  }
  const splitCharacters = (word) => packPieces(Array.from(word), maxBytes, () => []);
  const splitWords = (sentence) =>
    packPieces(sentence.match(/\S+\s*|\s+/gu) ?? [sentence], maxBytes, splitCharacters);
  return packPieces(splitSentences(clean), maxBytes, splitWords);
}

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** MyMemory bazen yanıtta HTML varlıkları döndürür (&#39; gibi); düz metne çevrilir. */
export function decodeEntities(text) {
  if (!text.includes('&')) {
    return text;
  }
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const codePoint = Number.parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

export function buildMyMemoryUrl({ text, source, target, email = '' }) {
  const params = new URLSearchParams({
    q: text,
    langpair: `${source === AUTO_LANGUAGE ? 'autodetect' : source}|${target}`,
  });
  if (email) {
    params.set('de', email);
  }
  return `${MYMEMORY_ENDPOINT}?${params}`;
}

const QUOTA_PATTERN = /^MYMEMORY WARNING/i;
const SAME_LANGUAGE_PATTERN = /^PLEASE SELECT TWO DISTINCT LANGUAGES/i;
const LANGUAGE_ERROR_PATTERN = /INVALID (SOURCE|TARGET) LANGUAGE|IS AN INVALID|LANGPAIR/i;

export function parseMyMemoryResponse(data) {
  const status = Number(data?.responseStatus);
  const translated = data?.responseData?.translatedText;
  const details = typeof data?.responseDetails === 'string' ? data.responseDetails : '';

  if (data?.quotaFinished === true || status === 429 || QUOTA_PATTERN.test(translated ?? '')) {
    throw new TranslationError('quota', details || translated || 'quota');
  }
  if (SAME_LANGUAGE_PATTERN.test(translated ?? '') || SAME_LANGUAGE_PATTERN.test(details)) {
    throw new TranslationError('same-language', details || translated);
  }
  if (status !== 200 || typeof translated !== 'string') {
    if (LANGUAGE_ERROR_PATTERN.test(translated ?? '') || LANGUAGE_ERROR_PATTERN.test(details)) {
      throw new TranslationError('language', details || translated);
    }
    throw new TranslationError('service', details || `HTTP ${Number.isNaN(status) ? '?' : status}`);
  }

  const detectedLanguage = data.responseData.detectedLanguage;
  return {
    text: decodeEntities(translated),
    detectedLanguage: typeof detectedLanguage === 'string' && detectedLanguage ? detectedLanguage : null,
  };
}

// Dış iptal sinyalini ve zaman aşımını tek bir AbortController'da birleştirir
// (AbortSignal.any eski iOS sürümlerinde yoktur).
function createRequestSignal(signal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener('abort', forwardAbort, { once: true });
  }
  return {
    signal: controller.signal,
    wasTimedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forwardAbort);
    },
  };
}

async function requestMyMemory({ text, source, target, email, fetchImpl, signal, timeoutMs }) {
  if (signal?.aborted) {
    throw new TranslationError('aborted');
  }
  const request = createRequestSignal(signal, timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(buildMyMemoryUrl({ text, source, target, email }), {
        signal: request.signal,
      });
    } catch (error) {
      if (request.signal.aborted) {
        throw new TranslationError(request.wasTimedOut() ? 'timeout' : 'aborted', '', { cause: error });
      }
      throw new TranslationError('network', error?.message, { cause: error });
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      if (request.signal.aborted) {
        throw new TranslationError(request.wasTimedOut() ? 'timeout' : 'aborted', '', { cause: error });
      }
      if (response.status === 429) {
        throw new TranslationError('quota', 'HTTP 429', { cause: error });
      }
      throw new TranslationError('service', `HTTP ${response.status}`, { cause: error });
    }
    if (response.status === 429) {
      throw new TranslationError('quota', 'HTTP 429');
    }
    return parseMyMemoryResponse(data);
  } finally {
    request.dispose();
  }
}

function normalizeNewlines(text) {
  return text.replace(/\r\n?/g, '\n');
}

// Boşluksuz yazılan dillerde parçalar arasına boşluk eklenmez.
function segmentJoiner(target) {
  return /^(zh|ja)/i.test(target) ? '' : ' ';
}

async function translateWithMyMemory({ text, source, target, email, fetchImpl, signal, timeoutMs, onProgress, onUsage }) {
  if (globalThis.navigator?.onLine === false) {
    throw new TranslationError('offline');
  }
  if (typeof fetchImpl !== 'function') {
    throw new TranslationError('network', 'fetch yok');
  }

  const plan = normalizeNewlines(text).trim().split('\n').map((line) => splitIntoSegments(line));
  const total = plan.reduce((sum, segments) => sum + segments.length, 0);
  const joiner = segmentJoiner(target);
  let done = 0;
  let requestSource = source;
  let detectedLanguage = null;
  const translatedLines = [];

  for (const segments of plan) {
    const parts = [];
    for (const segment of segments) {
      const result = await requestMyMemory({ text: segment, source: requestSource, target, email, fetchImpl, signal, timeoutMs });
      onUsage?.(countCharacters(segment));
      if (source === AUTO_LANGUAGE && !detectedLanguage && result.detectedLanguage) {
        detectedLanguage = normalizeLanguageCode(result.detectedLanguage);
        // Algılanan dil sonraki parçalarda da kullanılır; hedef dille aynıysa servis
        // "iki farklı dil seçin" hatası vereceğinden otomatik algılamada kalınır.
        if (detectedLanguage && !sameLanguage(detectedLanguage, target)) {
          requestSource = detectedLanguage;
        }
      }
      parts.push(result.text);
      done += 1;
      onProgress?.({ done, total });
    }
    translatedLines.push(parts.join(joiner));
  }

  return { text: translatedLines.join('\n'), detectedLanguage, engine: 'mymemory' };
}

// Aynı API nesnesi ve dil çifti için oluşturulan çevirmen yeniden kullanılır.
const deviceTranslatorCache = new WeakMap();

async function getDeviceTranslator(api, sourceLanguage, targetLanguage) {
  let cache = deviceTranslatorCache.get(api);
  if (!cache) {
    cache = new Map();
    deviceTranslatorCache.set(api, cache);
  }
  const key = `${sourceLanguage}|${targetLanguage}`;
  if (!cache.has(key)) {
    const created = api.create({ sourceLanguage, targetLanguage });
    cache.set(key, created);
    created.catch(() => cache.delete(key));
  }
  return cache.get(key);
}

async function detectOnDevice(text, deviceApi) {
  const Detector = deviceApi?.LanguageDetector;
  if (typeof Detector?.create !== 'function') {
    return null;
  }
  try {
    if (typeof Detector.availability === 'function' && (await Detector.availability()) !== 'available') {
      return null;
    }
    const detector = await Detector.create();
    const [best] = await detector.detect(text);
    if (!best || best.confidence < 0.6) {
      return null;
    }
    return normalizeLanguageCode(best.detectedLanguage);
  } catch (error) {
    console.warn('Cihaz içi dil algılama kullanılamadı:', error);
    return null;
  }
}

/** Tarayıcı cihaz içi çeviri API'si sunuyor mu? (Chrome 138+ masaüstü gibi) */
export function hasDeviceTranslator(deviceApi = globalThis) {
  const api = deviceApi?.Translator;
  return typeof api?.availability === 'function' && typeof api?.create === 'function';
}

/**
 * Cihazda indirilmiş model varsa çeviriyi ağsız yapar; yoksa null döner ve çevrimiçi
 * servise geçilir. Model indirme isteği kendiliğinden başlatılmaz.
 */
async function tryDeviceTranslation({ text, source, target, deviceApi, onProgress }) {
  if (!hasDeviceTranslator(deviceApi)) {
    return null;
  }

  let sourceLanguage = source;
  let detectedLanguage = null;
  if (source === AUTO_LANGUAGE) {
    detectedLanguage = await detectOnDevice(text, deviceApi);
    if (!detectedLanguage || sameLanguage(detectedLanguage, target)) {
      return null;
    }
    sourceLanguage = detectedLanguage;
  }

  const options = { sourceLanguage: toDeviceLanguage(sourceLanguage), targetLanguage: toDeviceLanguage(target) };
  try {
    if ((await deviceApi.Translator.availability(options)) !== 'available') {
      return null;
    }
    const translator = await getDeviceTranslator(deviceApi.Translator, options.sourceLanguage, options.targetLanguage);
    const lines = normalizeNewlines(text).trim().split('\n');
    const total = lines.filter((line) => line.trim()).length;
    let done = 0;
    const translatedLines = [];
    for (const line of lines) {
      if (!line.trim()) {
        translatedLines.push('');
        continue;
      }
      translatedLines.push(await translator.translate(line.trim()));
      done += 1;
      onProgress?.({ done, total });
    }
    return { text: translatedLines.join('\n'), detectedLanguage, engine: 'device' };
  } catch (error) {
    console.warn('Cihaz içi çeviri kullanılamadı, çevrimiçi servise geçiliyor:', error);
    return null;
  }
}

/**
 * Metni çevirir.
 * engine: 'auto' (önce cihaz içi, olmazsa çevrimiçi) veya 'online' (yalnızca MyMemory).
 * beforeOnline: metin ağa gönderilmeden hemen önce çağrılır (ör. gizlilik onayı).
 * Dönüş: { text, detectedLanguage, engine: 'device' | 'mymemory' }
 */
export async function translateText({
  text,
  source,
  target,
  engine = 'auto',
  email = '',
  fetchImpl = globalThis.fetch?.bind(globalThis),
  deviceApi = globalThis,
  signal,
  timeoutMs = REQUEST_TIMEOUT_MS,
  onProgress,
  onUsage,
  beforeOnline,
}) {
  const clean = typeof text === 'string' ? text.trim() : '';
  if (!clean) {
    throw new TranslationError('empty');
  }
  if (countCharacters(clean) > MAX_INPUT_CHARS) {
    throw new TranslationError('too-long');
  }
  if (source !== AUTO_LANGUAGE && sameLanguage(source, target)) {
    throw new TranslationError('same-language');
  }

  if (engine === 'auto') {
    const deviceResult = await tryDeviceTranslation({ text: clean, source, target, deviceApi, onProgress });
    if (deviceResult) {
      return deviceResult;
    }
  }

  // Metin cihazdan çıkmadan önce arayüz kullanıcı onayı isteyebilir; reddedilirse
  // kanca hata fırlatır ve hiçbir istek gönderilmez.
  await beforeOnline?.();
  return translateWithMyMemory({ text: clean, source, target, email, fetchImpl, signal, timeoutMs, onProgress, onUsage });
}

/* ---------- Geçmiş ---------- */

function historyKey(source, target, text) {
  return `${source}|${target}|${String(text).trim()}`;
}

export function findCachedTranslation(history, { text, source, target }) {
  const key = historyKey(source, target, text);
  return history.find((item) => historyKey(item.source, item.target, item.sourceText) === key);
}

/**
 * Kaydı geçmişin başına ekler. Aynı metin + dil çifti varsa yinelenmez: kimliği ve
 * favori durumu korunarak güncellenir. Favoriler sınıra dahil edilmez, silinmez.
 */
export function addToHistory(history, entry, maxEntries = MAX_HISTORY_ENTRIES) {
  const key = historyKey(entry.source, entry.target, entry.sourceText);
  const existing = history.find((item) => historyKey(item.source, item.target, item.sourceText) === key);
  const merged = {
    ...entry,
    sourceText: entry.sourceText.trim(),
    id: existing?.id ?? entry.id,
    favorite: Boolean(entry.favorite || existing?.favorite),
  };
  const rest = history.filter((item) => item !== existing);
  let regularCount = 0;
  return [merged, ...rest].filter((item) => item.favorite || ++regularCount <= maxEntries);
}

export function normalizeHistory(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter(
      (item) =>
        item &&
        typeof item === 'object' &&
        ['id', 'sourceText', 'translatedText', 'source', 'target'].every((field) => typeof item[field] === 'string')
    )
    .map((item) => ({
      id: item.id,
      sourceText: item.sourceText,
      translatedText: item.translatedText,
      source: item.source,
      target: item.target,
      detectedLanguage: typeof item.detectedLanguage === 'string' ? item.detectedLanguage : null,
      engine: item.engine === 'device' ? 'device' : 'mymemory',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date(0).toISOString(),
      favorite: item.favorite === true,
    }));
}

// Arama için Türkçe büyük/küçük harf ve aksan farkları yok sayılır (İ/ı/I → i, ç → c ...).
function foldForSearch(text) {
  return String(text)
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

export function filterHistory(history, { query = '', favoritesOnly = false } = {}) {
  const needle = foldForSearch(query.trim());
  return history.filter((item) => {
    if (favoritesOnly && !item.favorite) {
      return false;
    }
    if (!needle) {
      return true;
    }
    return foldForSearch(`${item.sourceText}\n${item.translatedText}`).includes(needle);
  });
}

/* ---------- Günlük kullanım (yaklaşık kota takibi) ---------- */

export function todayKey(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function readUsage(stored, key) {
  if (!stored || stored.date !== key) {
    return 0;
  }
  const chars = Number(stored.chars);
  return Number.isFinite(chars) && chars > 0 ? chars : 0;
}

export function addUsage(stored, key, chars) {
  return { date: key, chars: readUsage(stored, key) + chars };
}

export function getDailyLimit(email) {
  return email ? DAILY_LIMIT_WITH_EMAIL : DAILY_LIMIT_ANONYMOUS;
}
