// Çeviri motorunun DOM'dan bağımsız mantığını Node'un yerleşik test aracıyla doğrular.
// Çalıştırma: npm test (ceviri/ klasöründe)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AUTO_LANGUAGE,
  TranslationError,
  addToHistory,
  addUsage,
  buildMyMemoryUrl,
  byteLength,
  decodeEntities,
  describeError,
  filterHistory,
  findCachedTranslation,
  normalizeHistory,
  parseMyMemoryResponse,
  readUsage,
  splitIntoSegments,
  translateText,
} from '../ceviri-motoru.js';
import { getLanguageName, isRtl, normalizeLanguageCode, sameLanguage } from '../diller.js';

function okResponse(translatedText, extra = {}) {
  return {
    responseData: { translatedText, match: 0.9, ...extra },
    quotaFinished: false,
    responseDetails: '',
    responseStatus: 200,
  };
}

function createFakeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    const call = {
      q: parsed.searchParams.get('q'),
      langpair: parsed.searchParams.get('langpair'),
      de: parsed.searchParams.get('de'),
      init,
    };
    calls.push(call);
    const { status = 200, body } = await handler(call, calls.length);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (typeof body === 'string') {
          return JSON.parse(body);
        }
        return body;
      },
    };
  };
  return { fetchImpl, calls };
}

describe('dil yardımcıları', () => {
  it('servisten gelen dil kodlarını listedeki kodlara eşler', () => {
    assert.equal(normalizeLanguageCode('de-DE'), 'de');
    assert.equal(normalizeLanguageCode('EN'), 'en');
    assert.equal(normalizeLanguageCode('zh'), 'zh-CN');
    assert.equal(normalizeLanguageCode('zh-Hans'), 'zh-CN');
    assert.equal(normalizeLanguageCode('zh-TW'), 'zh-TW');
    assert.equal(normalizeLanguageCode('zh-Hant'), 'zh-TW');
    assert.equal(normalizeLanguageCode('nb'), 'no');
    assert.equal(normalizeLanguageCode('iw'), 'he');
    assert.equal(normalizeLanguageCode('xx'), null);
    assert.equal(normalizeLanguageCode(''), null);
    assert.equal(normalizeLanguageCode(undefined), null);
  });

  it('aynı dili bölge koduna bakmadan tanır', () => {
    assert.equal(sameLanguage('tr', 'tr-TR'), true);
    assert.equal(sameLanguage('zh-CN', 'zh-TW'), false);
    assert.equal(sameLanguage('en', 'de'), false);
  });

  it('dil adlarını ve yazı yönünü verir', () => {
    assert.equal(getLanguageName('tr'), 'Türkçe');
    assert.equal(getLanguageName(AUTO_LANGUAGE), 'Dili algıla');
    assert.equal(getLanguageName('xx'), 'xx');
    assert.equal(isRtl('ar'), true);
    assert.equal(isRtl('tr'), false);
  });
});

describe('splitIntoSegments', () => {
  it('boş metin için parça üretmez', () => {
    assert.deepEqual(splitIntoSegments('   '), []);
  });

  it('sınırın altındaki metni tek parça bırakır', () => {
    assert.deepEqual(splitIntoSegments('  Merhaba dünya.  '), ['Merhaba dünya.']);
  });

  it('uzun metni cümle sınırlarından böler ve her parça bayt sınırında kalır', () => {
    // İlk iki cümle 49 bayt; 30 baytlık sınırda ayrı parçalara düşer.
    const text = 'Bugün hava çok güzel. Yarın yağmur yağacak! Öbür gün ne olacağını kimse bilmiyor? Şimdilik plan yok.';
    const segments = splitIntoSegments(text, 30);
    assert.ok(segments.length > 1);
    segments.forEach((segment) => assert.ok(byteLength(segment) <= 30, segment));
    assert.equal(segments.join(' '), text);
    assert.equal(segments[0], 'Bugün hava çok güzel.');
  });

  it('sınıra sığan kısa cümleleri istek sayısını azaltmak için birleştirir', () => {
    const segments = splitIntoSegments('Bugün hava çok güzel. Yarın yağmur yağacak! Sonra kar.', 50);
    assert.deepEqual(segments, ['Bugün hava çok güzel. Yarın yağmur yağacak!', 'Sonra kar.']);
  });

  it('çok uzun cümleyi kelimelerden, çok uzun kelimeyi karakterlerden böler', () => {
    const longWord = 'ğ'.repeat(40); // 80 bayt
    const text = `kısa kelimeler burada ${longWord} son`;
    const segments = splitIntoSegments(text, 30);
    segments.forEach((segment) => assert.ok(byteLength(segment) <= 30, segment));
    assert.equal(segments.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
  });

  it('noktalama ile başlayan metinde karakter kaybetmez', () => {
    const text = '...ve sonra. Gerisi geldi.';
    assert.equal(splitIntoSegments(text, 15).join(' '), text);
  });

  it('Çince/Japonca cümle sonlarını da tanır', () => {
    const segments = splitIntoSegments('今日は晴れです。明日は雨です。', 24);
    assert.deepEqual(segments, ['今日は晴れです。', '明日は雨です。']);
  });
});

describe('decodeEntities', () => {
  it('sayısal ve adlandırılmış HTML varlıklarını çözer', () => {
    assert.equal(decodeEntities('It&#39;s &quot;ok&quot; &amp; fine'), 'It\'s "ok" & fine');
    assert.equal(decodeEntities('&#x27;a&#X27; &lt;b&gt;'), "'a' <b>");
    assert.equal(decodeEntities('a&nbsp;b'), 'a b');
  });

  it('tanınmayan varlıkları ve tek geçişi korur', () => {
    assert.equal(decodeEntities('&foo; &amp;lt;'), '&foo; &lt;');
    assert.equal(decodeEntities('düz metin'), 'düz metin');
  });
});

describe('buildMyMemoryUrl', () => {
  it('otomatik algılamayı autodetect olarak gönderir', () => {
    const url = new URL(buildMyMemoryUrl({ text: 'Hallo', source: AUTO_LANGUAGE, target: 'tr' }));
    assert.equal(url.origin + url.pathname, 'https://api.mymemory.translated.net/get');
    assert.equal(url.searchParams.get('q'), 'Hallo');
    assert.equal(url.searchParams.get('langpair'), 'autodetect|tr');
    assert.equal(url.searchParams.has('de'), false);
  });

  it('e-posta verilirse de parametresini ekler', () => {
    const url = new URL(buildMyMemoryUrl({ text: 'a', source: 'en', target: 'tr', email: 'kisi@example.com' }));
    assert.equal(url.searchParams.get('langpair'), 'en|tr');
    assert.equal(url.searchParams.get('de'), 'kisi@example.com');
  });
});

describe('parseMyMemoryResponse', () => {
  it('başarılı yanıtı ve algılanan dili döndürür', () => {
    const result = parseMyMemoryResponse(okResponse('Günaydın &#39;dostum&#39;', { detectedLanguage: 'de' }));
    assert.deepEqual(result, { text: "Günaydın 'dostum'", detectedLanguage: 'de' });
  });

  it('kota bitişini tanır', () => {
    assert.throws(
      () => parseMyMemoryResponse({ ...okResponse('x'), quotaFinished: true }),
      (error) => error instanceof TranslationError && error.code === 'quota'
    );
    assert.throws(
      () => parseMyMemoryResponse(okResponse('MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY.')),
      (error) => error.code === 'quota'
    );
  });

  it('dil hatalarını ayırt eder', () => {
    assert.throws(
      () => parseMyMemoryResponse({ ...okResponse("'XX' IS AN INVALID TARGET LANGUAGE . EXAMPLE: LANGPAIR=EN|IT"), responseStatus: 403 }),
      (error) => error.code === 'language'
    );
    assert.throws(
      () => parseMyMemoryResponse({ ...okResponse('PLEASE SELECT TWO DISTINCT LANGUAGES'), responseStatus: '403' }),
      (error) => error.code === 'same-language'
    );
  });

  it('beklenmeyen yanıtı servis hatası sayar', () => {
    assert.throws(() => parseMyMemoryResponse(null), (error) => error.code === 'service');
    assert.throws(
      () => parseMyMemoryResponse({ responseStatus: 500, responseDetails: 'Sunucu hatası' }),
      (error) => error.code === 'service'
    );
  });
});

describe('translateText (çevrimiçi)', () => {
  it('boş metni ve aynı dil çiftini ağa gitmeden reddeder', async () => {
    const { fetchImpl, calls } = createFakeFetch(() => ({ body: okResponse('x') }));
    await assert.rejects(
      translateText({ text: '  ', source: 'en', target: 'tr', engine: 'online', fetchImpl }),
      (error) => error.code === 'empty'
    );
    await assert.rejects(
      translateText({ text: 'Merhaba', source: 'tr', target: 'tr', engine: 'online', fetchImpl }),
      (error) => error.code === 'same-language'
    );
    await assert.rejects(
      translateText({ text: 'a'.repeat(5001), source: 'en', target: 'tr', engine: 'online', fetchImpl }),
      (error) => error.code === 'too-long'
    );
    assert.equal(calls.length, 0);
  });

  it('satırları korur, algılanan dili sonraki parçalarda kullanır ve kullanımı bildirir', async () => {
    const { fetchImpl, calls } = createFakeFetch((call) => ({
      body: okResponse(`[${call.q}]`, call.langpair.startsWith('autodetect') ? { detectedLanguage: 'en-GB' } : {}),
    }));
    const usage = [];
    const progress = [];
    const result = await translateText({
      text: 'Hello.\r\n\r\nGood morning.\nBye.',
      source: AUTO_LANGUAGE,
      target: 'tr',
      engine: 'online',
      fetchImpl,
      onUsage: (chars) => usage.push(chars),
      onProgress: (state) => progress.push(state),
    });

    assert.equal(result.text, '[Hello.]\n\n[Good morning.]\n[Bye.]');
    assert.equal(result.detectedLanguage, 'en');
    assert.equal(result.engine, 'mymemory');
    assert.deepEqual(calls.map((call) => call.langpair), ['autodetect|tr', 'en|tr', 'en|tr']);
    assert.deepEqual(usage, [6, 13, 4]);
    assert.deepEqual(progress.at(-1), { done: 3, total: 3 });
  });

  it('algılanan dil hedef dille aynıysa sonraki parçalarda da otomatik algılar', async () => {
    const { fetchImpl, calls } = createFakeFetch((call) => ({
      body: okResponse(call.q, { detectedLanguage: 'tr' }),
    }));
    const result = await translateText({
      text: 'Merhaba.\nNasılsın?',
      source: AUTO_LANGUAGE,
      target: 'tr',
      engine: 'online',
      fetchImpl,
    });
    assert.equal(result.detectedLanguage, 'tr');
    assert.deepEqual(calls.map((call) => call.langpair), ['autodetect|tr', 'autodetect|tr']);
  });

  it('e-postayı isteğe ekler', async () => {
    const { fetchImpl, calls } = createFakeFetch(() => ({ body: okResponse('Merhaba') }));
    await translateText({ text: 'Hello', source: 'en', target: 'tr', engine: 'online', email: 'a@b.co', fetchImpl });
    assert.equal(calls[0].de, 'a@b.co');
  });

  it('ağ hatasını, HTTP 429 kotasını ve bozuk yanıtı ayırt eder', async () => {
    const failing = async () => {
      throw new TypeError('Failed to fetch');
    };
    await assert.rejects(
      translateText({ text: 'Hello', source: 'en', target: 'tr', engine: 'online', fetchImpl: failing }),
      (error) => error.code === 'network'
    );

    const quota = createFakeFetch(() => ({ status: 429, body: 'Too many' }));
    await assert.rejects(
      translateText({ text: 'Hello', source: 'en', target: 'tr', engine: 'online', fetchImpl: quota.fetchImpl }),
      (error) => error.code === 'quota'
    );

    const broken = createFakeFetch(() => ({ status: 502, body: '<html>' }));
    await assert.rejects(
      translateText({ text: 'Hello', source: 'en', target: 'tr', engine: 'online', fetchImpl: broken.fetchImpl }),
      (error) => error.code === 'service'
    );
  });

  it('zaman aşımında ve iptalde isteği durdurur', async () => {
    const hanging = (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });

    await assert.rejects(
      translateText({ text: 'Hello', source: 'en', target: 'tr', engine: 'online', fetchImpl: hanging, timeoutMs: 20 }),
      (error) => error.code === 'timeout'
    );

    const controller = new AbortController();
    const pending = translateText({
      text: 'Hello',
      source: 'en',
      target: 'tr',
      engine: 'online',
      fetchImpl: hanging,
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(pending, (error) => error.code === 'aborted');
  });
});

describe('translateText (cihaz içi)', () => {
  function createDeviceApi({ availability = 'available', detected = null } = {}) {
    const created = [];
    const api = {
      Translator: {
        availability: async () => availability,
        create: async (options) => {
          created.push(options);
          return { translate: async (text) => `<${options.targetLanguage}:${text}>` };
        },
      },
    };
    if (detected) {
      api.LanguageDetector = {
        availability: async () => 'available',
        create: async () => ({ detect: async () => [detected] }),
      };
    }
    return { api, created };
  }

  it('model hazırsa ağa gitmeden cihazda çevirir', async () => {
    const { fetchImpl, calls } = createFakeFetch(() => ({ body: okResponse('x') }));
    const { api, created } = createDeviceApi();
    const result = await translateText({
      text: 'Hello\n\nWorld',
      source: 'en',
      target: 'zh-TW',
      engine: 'auto',
      fetchImpl,
      deviceApi: api,
    });
    assert.equal(result.engine, 'device');
    assert.equal(result.text, '<zh-Hant:Hello>\n\n<zh-Hant:World>');
    assert.deepEqual(created[0], { sourceLanguage: 'en', targetLanguage: 'zh-Hant' });
    assert.equal(calls.length, 0);
  });

  it('model indirilmemişse çevrimiçi servise geçer', async () => {
    const { fetchImpl, calls } = createFakeFetch(() => ({ body: okResponse('Merhaba') }));
    const { api } = createDeviceApi({ availability: 'downloadable' });
    const result = await translateText({ text: 'Hello', source: 'en', target: 'tr', engine: 'auto', fetchImpl, deviceApi: api });
    assert.equal(result.engine, 'mymemory');
    assert.equal(calls.length, 1);
  });

  it('otomatik algılamayı cihazdaki dil algılayıcıyla yapar', async () => {
    const { fetchImpl } = createFakeFetch(() => ({ body: okResponse('x') }));
    const { api } = createDeviceApi({ detected: { detectedLanguage: 'de', confidence: 0.97 } });
    const result = await translateText({ text: 'Hallo', source: AUTO_LANGUAGE, target: 'tr', engine: 'auto', fetchImpl, deviceApi: api });
    assert.equal(result.engine, 'device');
    assert.equal(result.detectedLanguage, 'de');
  });

  it('onay kancasını yalnızca metin ağa gidecekse çağırır; ret hiçbir istek göndermez', async () => {
    const { fetchImpl, calls } = createFakeFetch(() => ({ body: okResponse('Merhaba') }));
    let asked = 0;
    const deny = async () => {
      asked += 1;
      throw new TranslationError('consent');
    };

    const { api } = createDeviceApi();
    const deviceResult = await translateText({ text: 'Hello', source: 'en', target: 'tr', engine: 'auto', fetchImpl, deviceApi: api, beforeOnline: deny });
    assert.equal(deviceResult.engine, 'device');
    assert.equal(asked, 0);

    await assert.rejects(
      translateText({ text: 'Hello', source: 'en', target: 'tr', engine: 'online', fetchImpl, beforeOnline: deny }),
      (error) => error.code === 'consent'
    );
    assert.equal(asked, 1);
    assert.equal(calls.length, 0);
  });

  it('yalnızca çevrimiçi seçildiğinde cihaz modelini kullanmaz', async () => {
    const { fetchImpl, calls } = createFakeFetch(() => ({ body: okResponse('Merhaba') }));
    const { api, created } = createDeviceApi();
    const result = await translateText({ text: 'Hello', source: 'en', target: 'tr', engine: 'online', fetchImpl, deviceApi: api });
    assert.equal(result.engine, 'mymemory');
    assert.equal(created.length, 0);
    assert.equal(calls.length, 1);
  });
});

describe('geçmiş', () => {
  const base = {
    sourceText: 'Hello',
    translatedText: 'Merhaba',
    source: 'en',
    target: 'tr',
    detectedLanguage: null,
    engine: 'mymemory',
    favorite: false,
  };

  it('aynı çeviriyi tekrar eklemez; başa taşır, kimliği ve favoriyi korur', () => {
    let history = addToHistory([], { ...base, id: 'a', createdAt: '2026-01-01T00:00:00.000Z' });
    history = addToHistory(history, { ...base, id: 'b', sourceText: 'Bye', translatedText: 'Hoşça kal', createdAt: '2026-01-02T00:00:00.000Z' });
    history = history.map((item) => (item.id === 'a' ? { ...item, favorite: true } : item));
    history = addToHistory(history, { ...base, id: 'c', sourceText: ' Hello ', translatedText: 'Selam', createdAt: '2026-01-03T00:00:00.000Z' });

    assert.equal(history.length, 2);
    assert.equal(history[0].id, 'a');
    assert.equal(history[0].favorite, true);
    assert.equal(history[0].translatedText, 'Selam');
    assert.equal(history[0].createdAt, '2026-01-03T00:00:00.000Z');
  });

  it('sınırı aşınca en eski favori olmayan kayıtları siler', () => {
    let history = [];
    history = addToHistory(history, { ...base, id: 'fav', sourceText: 'fav', favorite: true }, 2);
    for (let index = 0; index < 4; index += 1) {
      history = addToHistory(history, { ...base, id: `n${index}`, sourceText: `n${index}` }, 2);
    }
    assert.deepEqual(history.map((item) => item.id), ['n3', 'n2', 'fav']);
  });

  it('önbellekte birebir eşleşmeyi bulur', () => {
    const history = addToHistory([], { ...base, id: 'a' });
    assert.equal(findCachedTranslation(history, { text: 'Hello ', source: 'en', target: 'tr' })?.id, 'a');
    assert.equal(findCachedTranslation(history, { text: 'Hello', source: AUTO_LANGUAGE, target: 'tr' }), undefined);
    assert.equal(findCachedTranslation(history, { text: 'Hello', source: 'en', target: 'de' }), undefined);
  });

  it('Türkçe büyük/küçük harfe duyarsız arar ve favorileri süzer', () => {
    const history = [
      { ...base, id: '1', sourceText: 'İstanbul', translatedText: 'Istanbul' },
      { ...base, id: '2', sourceText: 'Ankara', translatedText: 'Ankara', favorite: true },
    ];
    assert.deepEqual(filterHistory(history, { query: 'istanbul' }).map((item) => item.id), ['1']);
    assert.deepEqual(filterHistory(history, { query: 'ISTANBUL' }).map((item) => item.id), ['1']);
    assert.deepEqual(filterHistory(history, { favoritesOnly: true }).map((item) => item.id), ['2']);
    assert.equal(filterHistory(history, { query: '' }).length, 2);
  });

  it('bozuk kayıtları ayıklar', () => {
    const normalized = normalizeHistory([
      { ...base, id: 'ok', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'eksik' },
      null,
      'metin',
    ]);
    assert.deepEqual(normalized.map((item) => item.id), ['ok']);
    assert.deepEqual(normalizeHistory('bozuk'), []);
  });
});

describe('günlük kullanım', () => {
  it('gün değişince sayacı sıfırlar ve aynı günde toplar', () => {
    assert.equal(readUsage(null, '2026-11-09'), 0);
    assert.equal(readUsage({ date: '2026-11-08', chars: 900 }, '2026-11-09'), 0);
    const first = addUsage({ date: '2026-11-08', chars: 900 }, '2026-11-09', 120);
    assert.deepEqual(first, { date: '2026-11-09', chars: 120 });
    assert.deepEqual(addUsage(first, '2026-11-09', 30), { date: '2026-11-09', chars: 150 });
  });
});

describe('describeError', () => {
  it('her hata koduna Türkçe açıklama verir', () => {
    for (const code of ['empty', 'same-language', 'too-long', 'offline', 'network', 'timeout', 'quota', 'language', 'service', 'aborted', 'consent']) {
      const message = describeError(new TranslationError(code, ''));
      assert.ok(message.length > 10, code);
    }
    assert.match(describeError(new Error('beklenmeyen')), /Çeviri yapılamadı/);
  });
});
