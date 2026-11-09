// Çevirilerim arayüzü: dil seçimi, çeviri, geçmiş/favoriler, ayarlar ve çevrimdışı destek.
// Çeviri mantığı ceviri-motoru.js'de, dil listesi diller.js'dedir.
import {
  AUTO_LANGUAGE,
  LANGUAGES,
  getLanguageName,
  isRtl,
  isSupportedLanguage,
  normalizeLanguageCode,
  sameLanguage,
} from './diller.js';
import {
  MAX_INPUT_CHARS,
  TranslationError,
  addToHistory,
  addUsage,
  countCharacters,
  describeError,
  filterHistory,
  findCachedTranslation,
  getDailyLimit,
  hasDeviceTranslator,
  normalizeHistory,
  readUsage,
  todayKey,
  translateText,
} from './ceviri-motoru.js';

const THEME_STORAGE_KEY = 'ceviri-theme';
const SETTINGS_STORAGE_KEY = 'ceviri-settings-v1';
const HISTORY_STORAGE_KEY = 'ceviri-history-v1';
const USAGE_STORAGE_KEY = 'ceviri-usage-v1';
const DRAFT_STORAGE_KEY = 'ceviri-draft-v1';
const RECENT_COUNT = 3;
const DRAFT_SAVE_DELAY_MS = 400;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Doğrulama türündeki hatalar çıktı alanını silmeden yalnızca durum satırında gösterilir.
const INLINE_ERROR_CODES = new Set(['empty', 'same-language', 'too-long', 'consent', 'aborted']);

const sourceSelect = document.getElementById('source-language');
const targetSelect = document.getElementById('target-language');
const swapBtn = document.getElementById('swap-btn');
const sourceText = document.getElementById('source-text');
const charCounter = document.getElementById('char-counter');
const detectedLanguageLabel = document.getElementById('detected-language');
const speakSourceBtn = document.getElementById('speak-source-btn');
const clearSourceBtn = document.getElementById('clear-source-btn');
const translateBtn = document.getElementById('translate-btn');
const outputText = document.getElementById('output-text');
const engineLabel = document.getElementById('engine-label');
const translateStatus = document.getElementById('translate-status');
const favoriteBtn = document.getElementById('favorite-btn');
const speakOutputBtn = document.getElementById('speak-output-btn');
const copyBtn = document.getElementById('copy-btn');
const shareBtn = document.getElementById('share-btn');
const recentList = document.getElementById('recent-list');
const historyList = document.getElementById('history-list');
const historyItemTemplate = document.getElementById('history-item-template');
const historySearch = document.getElementById('history-search');
const historyCount = document.getElementById('history-count');
const historyFilters = document.querySelectorAll('.filter-btn[data-filter]');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const connectionLabel = document.getElementById('connection-label');
const installStatus = document.getElementById('install-status');
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const engineInputs = document.querySelectorAll('input[name="engine"]');
const engineStatus = document.getElementById('engine-status');
const usageMeter = document.getElementById('usage-meter');
const usageText = document.getElementById('usage-text');
const emailForm = document.getElementById('email-form');
const emailInput = document.getElementById('quota-email');
const clearEmailBtn = document.getElementById('clear-email-btn');
const emailStatus = document.getElementById('email-status');
const consentStatus = document.getElementById('consent-status');
const revokeConsentBtn = document.getElementById('revoke-consent-btn');
const consentDialog = document.getElementById('consent-dialog');
const consentAcceptBtn = document.getElementById('consent-accept-btn');
const consentCancelBtn = document.getElementById('consent-cancel-btn');
const pageLinks = document.querySelectorAll('.menu-category[data-open-page]');
const pagePanels = document.querySelectorAll('[data-page-panel]');
const appMenu = document.getElementById('app-menu');
const appMenuSummary = appMenu.querySelector(':scope > summary');
const appMenuHint = document.getElementById('app-menu-hint');
const menuGroups = document.querySelectorAll('.menu-group');

const numberFormat = new Intl.NumberFormat('tr-TR');
const dateFormat = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });

/* ---------- Depolama ---------- */

// localStorage gizli sekmede veya kota dolduğunda hata fırlatabilir; uygulama yine de açılmalı.
function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.error('Depolama okunamadı:', error);
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.error('Depolamaya yazılamadı:', error);
    return false;
  }
}

function removeStorage(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error('Depolamadan silinemedi:', error);
  }
}

function readJson(key, fallback) {
  const raw = readStorage(key);
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error('Kaydedilen veri okunamadı:', key, error);
    return fallback;
  }
}

function writeJson(key, value) {
  return writeStorage(key, JSON.stringify(value));
}

// crypto.randomUUID yalnızca güvenli bağlamda (HTTPS/localhost) vardır; telefondan LAN IP'si
// ile açıldığında da çalışması için yedek kimlik üretici kullanılır.
function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function loadSettings() {
  const raw = readJson(SETTINGS_STORAGE_KEY, {}) ?? {};
  const source = raw.source === AUTO_LANGUAGE || isSupportedLanguage(raw.source) ? raw.source : AUTO_LANGUAGE;
  let target = isSupportedLanguage(raw.target) ? raw.target : 'tr';
  if (source !== AUTO_LANGUAGE && sameLanguage(source, target)) {
    target = sameLanguage(source, 'tr') ? 'en' : 'tr';
  }
  return {
    engine: raw.engine === 'online' ? 'online' : 'auto',
    email: typeof raw.email === 'string' && EMAIL_PATTERN.test(raw.email) ? raw.email : '',
    consent: raw.consent === true,
    source,
    target,
  };
}

let settings = loadSettings();
let history = normalizeHistory(readJson(HISTORY_STORAGE_KEY, []));
let usage = readJson(USAGE_STORAGE_KEY, null);
let historyFilter = 'all';
// Çıktı alanında gösterilen metin; entryId yalnızca geçmişteki bir kayda karşılık geliyorsa dolu.
let currentOutput = null;
let activeTranslation = null;
let pendingConsent = null;
let draftTimer = 0;
let activeSpeechButton = null;
let previousSource = settings.source;
let previousTarget = settings.target;

function saveSettings() {
  writeJson(SETTINGS_STORAGE_KEY, settings);
}

function saveHistory() {
  if (!writeJson(HISTORY_STORAGE_KEY, history)) {
    translateStatus.textContent = 'Geçmiş kaydedilemedi. Cihaz depolama alanı dolu olabilir.';
  }
}

/* ---------- Dil seçimi ---------- */

function fillLanguageSelect(select, { includeAuto }) {
  const fragment = document.createDocumentFragment();
  if (includeAuto) {
    fragment.append(new Option('Dili algıla', AUTO_LANGUAGE));
  }
  const common = document.createElement('optgroup');
  common.label = 'Sık kullanılan';
  LANGUAGES.filter((language) => language.common).forEach((language) => {
    common.append(new Option(language.name, language.code));
  });
  const others = document.createElement('optgroup');
  others.label = 'Tüm diller';
  LANGUAGES.filter((language) => !language.common)
    .sort((first, second) => first.name.localeCompare(second.name, 'tr'))
    .forEach((language) => others.append(new Option(language.name, language.code)));
  fragment.append(common, others);
  select.replaceChildren(fragment);
}

function applyLanguageAttributes() {
  const source = sourceSelect.value;
  sourceText.lang = source === AUTO_LANGUAGE ? '' : source;
  sourceText.dir = source !== AUTO_LANGUAGE && isRtl(source) ? 'rtl' : 'auto';
}

function storeLanguageSelection() {
  settings = { ...settings, source: sourceSelect.value, target: targetSelect.value };
  previousSource = sourceSelect.value;
  previousTarget = targetSelect.value;
  saveSettings();
  applyLanguageAttributes();
}

// Kaynak ve hedef aynı dile getirilirse diğer seçim önceki değere kaydırılır (yer değiştirme).
function handleSourceChange() {
  const source = sourceSelect.value;
  if (source !== AUTO_LANGUAGE && sameLanguage(source, targetSelect.value)) {
    targetSelect.value = previousSource !== AUTO_LANGUAGE && !sameLanguage(previousSource, source)
      ? previousSource
      : sameLanguage(source, 'tr') ? 'en' : 'tr';
  }
  storeLanguageSelection();
  updateDetectedLabel();
}

function handleTargetChange() {
  const target = targetSelect.value;
  if (sourceSelect.value !== AUTO_LANGUAGE && sameLanguage(sourceSelect.value, target)) {
    sourceSelect.value = sameLanguage(previousTarget, target) ? AUTO_LANGUAGE : previousTarget;
  }
  storeLanguageSelection();
  updateDetectedLabel();
}

function getCurrentEntry() {
  return currentOutput?.entryId ? history.find((item) => item.id === currentOutput.entryId) ?? null : null;
}

function swapLanguages() {
  let nextTarget = sourceSelect.value;
  if (nextTarget === AUTO_LANGUAGE) {
    const detected = normalizeLanguageCode(getCurrentEntry()?.detectedLanguage);
    if (!detected || sameLanguage(detected, targetSelect.value)) {
      translateStatus.textContent = 'Dilleri değiştirmek için önce kaynak dili seçin ya da metni çevirin.';
      return;
    }
    nextTarget = detected;
  }

  const nextSource = targetSelect.value;
  const previousText = sourceText.value;
  sourceSelect.value = nextSource;
  targetSelect.value = nextTarget;
  storeLanguageSelection();

  // Metinler de yer değiştirir: çeviri girişe, önceki metin çıktıya geçer.
  if (currentOutput && !currentOutput.isError) {
    sourceText.value = currentOutput.text;
    if (previousText.trim()) {
      setOutput({ text: previousText.trim(), lang: nextTarget, entryId: null, engine: null });
    } else {
      resetOutput();
    }
    translateStatus.textContent = 'Diller ve metinler yer değiştirdi.';
  } else {
    translateStatus.textContent = 'Diller yer değiştirdi.';
  }
  updateCharCounter();
  scheduleDraftSave();
  updateDetectedLabel();
}

/* ---------- Metin girişi ---------- */

function updateCharCounter() {
  const count = countCharacters(sourceText.value);
  charCounter.textContent = `${numberFormat.format(count)} / ${numberFormat.format(MAX_INPUT_CHARS)}`;
  charCounter.classList.toggle('near-limit', count > MAX_INPUT_CHARS * 0.9);
  clearSourceBtn.disabled = count === 0;
  speakSourceBtn.disabled = count === 0;
}

function saveDraftNow() {
  clearTimeout(draftTimer);
  draftTimer = 0;
  if (sourceText.value) {
    writeStorage(DRAFT_STORAGE_KEY, sourceText.value);
  } else {
    removeStorage(DRAFT_STORAGE_KEY);
  }
}

// Her tuşta değil, yazma durunca kaydedilir; sayfa gizlenirken bekleyen kayıt hemen yapılır.
function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraftNow, DRAFT_SAVE_DELAY_MS);
}

function updateDetectedLabel() {
  const entry = getCurrentEntry();
  if (sourceSelect.value !== AUTO_LANGUAGE || !entry || entry.source !== AUTO_LANGUAGE) {
    detectedLanguageLabel.textContent = '';
    return;
  }
  const detected = normalizeLanguageCode(entry.detectedLanguage);
  if (!detected) {
    detectedLanguageLabel.textContent = '';
    return;
  }
  detectedLanguageLabel.textContent = sameLanguage(detected, entry.target)
    ? `Algılanan: ${getLanguageName(detected)} (hedef dille aynı)`
    : `Algılanan: ${getLanguageName(detected)}`;
}

/* ---------- Çıktı ---------- */

function setOutputActionsEnabled(enabled) {
  [speakOutputBtn, copyBtn, shareBtn].forEach((button) => {
    button.disabled = !enabled;
  });
}

function updateFavoriteButton() {
  const entry = getCurrentEntry();
  favoriteBtn.disabled = !entry;
  const isFavorite = Boolean(entry?.favorite);
  favoriteBtn.setAttribute('aria-pressed', String(isFavorite));
  favoriteBtn.textContent = isFavorite ? '★' : '☆';
  const label = isFavorite ? 'Favorilerden çıkar' : 'Favorilere ekle';
  favoriteBtn.setAttribute('aria-label', label);
  favoriteBtn.title = label;
}

function setOutput({ text, lang, entryId, engine, fromCache = false }) {
  stopSpeaking();
  currentOutput = { text, lang, entryId, isError: false };
  outputText.textContent = text;
  outputText.lang = lang || '';
  outputText.dir = isRtl(lang) ? 'rtl' : 'auto';
  outputText.classList.remove('is-empty', 'is-error');
  if (engine) {
    engineLabel.textContent = `${engine === 'device' ? 'Cihaz içi model' : 'MyMemory'}${fromCache ? ' · geçmişten' : ''}`;
  } else {
    engineLabel.textContent = '';
  }
  setOutputActionsEnabled(Boolean(text));
  updateFavoriteButton();
  updateDetectedLabel();
}

function resetOutput(message = 'Çeviri burada görünecek.') {
  stopSpeaking();
  currentOutput = null;
  outputText.textContent = message;
  outputText.removeAttribute('lang');
  outputText.dir = 'auto';
  outputText.classList.add('is-empty');
  outputText.classList.remove('is-error');
  engineLabel.textContent = '';
  setOutputActionsEnabled(false);
  updateFavoriteButton();
  updateDetectedLabel();
}

function showOutputError(message) {
  stopSpeaking();
  currentOutput = { text: '', lang: '', entryId: null, isError: true };
  outputText.textContent = message;
  outputText.removeAttribute('lang');
  outputText.classList.remove('is-empty');
  outputText.classList.add('is-error');
  engineLabel.textContent = '';
  setOutputActionsEnabled(false);
  updateFavoriteButton();
  updateDetectedLabel();
}

function showEntry(entry, { fromCache = false } = {}) {
  setOutput({
    text: entry.translatedText,
    lang: entry.target,
    entryId: entry.id,
    engine: entry.engine,
    fromCache,
  });
}

/* ---------- Gizlilik onayı ---------- */

function updateConsentStatus() {
  consentStatus.textContent = settings.consent
    ? 'Çevrimiçi çeviri için metninizin MyMemory’ye gönderilmesine izin verdiniz. İzni geri alırsanız bir sonraki çevrimiçi çeviride yeniden sorulur.'
    : 'Henüz izin verilmedi. Metniniz ilk kez çevrimiçi servise gönderilmeden önce izniniz sorulur.';
  revokeConsentBtn.disabled = !settings.consent;
}

// Metin cihazdan ilk kez çıkmadan önce amaç açıklanır; reddedilirse istek gönderilmez.
function ensureConsent() {
  if (settings.consent) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    pendingConsent = { resolve, reject };
    consentDialog.showModal();
  });
}

function finishConsent(accepted) {
  const pending = pendingConsent;
  pendingConsent = null;
  if (accepted) {
    settings = { ...settings, consent: true };
    saveSettings();
    updateConsentStatus();
  }
  if (consentDialog.open) {
    consentDialog.close(accepted ? 'accepted' : 'cancelled');
  }
  if (accepted) {
    pending?.resolve();
  } else {
    pending?.reject(new TranslationError('consent'));
  }
}

/* ---------- Çeviri ---------- */

function setBusy(isBusy) {
  translateBtn.disabled = isBusy;
  translateBtn.classList.toggle('is-busy', isBusy);
  translateBtn.textContent = isBusy ? 'Çevriliyor…' : 'Çevir';
  outputText.setAttribute('aria-busy', String(isBusy));
}

function recordUsage(chars) {
  usage = addUsage(usage, todayKey(), chars);
  writeJson(USAGE_STORAGE_KEY, usage);
  renderUsage();
}

function getUsageWarning() {
  const used = readUsage(usage, todayKey());
  const limit = getDailyLimit(settings.email);
  if (used >= limit) {
    return ' Bu cihazdan bugün günlük kota kadar çeviri yapıldı; servis yeni istekleri reddedebilir.';
  }
  if (used >= limit * 0.9) {
    return ' Günlük kotanın %90’ından fazlası kullanıldı.';
  }
  return '';
}

function describeTranslationError(error, source) {
  if (error instanceof TranslationError && error.code === 'same-language' && source === AUTO_LANGUAGE) {
    return 'Metin zaten hedef dilde görünüyor. Farklı bir hedef dil seçin.';
  }
  return describeError(error);
}

async function handleTranslate() {
  // Süren bir çeviri varsa (ör. Ctrl + Enter'a tekrar basıldıysa) yenisi başlatılmaz.
  if (activeTranslation) {
    return;
  }
  const text = sourceText.value.trim();
  const source = sourceSelect.value;
  const target = targetSelect.value;

  if (!text) {
    translateStatus.textContent = describeError(new TranslationError('empty'));
    sourceText.focus();
    return;
  }
  if (source !== AUTO_LANGUAGE && sameLanguage(source, target)) {
    translateStatus.textContent = describeError(new TranslationError('same-language'));
    targetSelect.focus();
    return;
  }

  // Aynı metin daha önce çevrildiyse kota harcamadan geçmişten getirilir (çevrimdışı da çalışır).
  const cached = findCachedTranslation(history, { text, source, target });
  if (cached) {
    history = addToHistory(history, { ...cached, createdAt: new Date().toISOString() });
    saveHistory();
    showEntry(history[0], { fromCache: true });
    translateStatus.textContent = 'Bu çeviri geçmişten getirildi; kota harcanmadı.';
    renderHistory();
    return;
  }

  const controller = new AbortController();
  activeTranslation = controller;
  setBusy(true);
  translateStatus.textContent = 'Çevriliyor…';

  try {
    const result = await translateText({
      text,
      source,
      target,
      engine: settings.engine,
      email: settings.email,
      signal: controller.signal,
      beforeOnline: ensureConsent,
      onUsage: recordUsage,
      onProgress: ({ done, total }) => {
        if (total > 1 && activeTranslation === controller) {
          translateStatus.textContent = `Çevriliyor… ${done}/${total} parça`;
        }
      },
    });
    if (activeTranslation !== controller) {
      return;
    }

    history = addToHistory(history, {
      id: createId(),
      sourceText: text,
      translatedText: result.text,
      source,
      target,
      detectedLanguage: result.detectedLanguage,
      engine: result.engine,
      createdAt: new Date().toISOString(),
      favorite: false,
    });
    saveHistory();
    showEntry(history[0]);
    translateStatus.textContent = `Çeviri tamamlandı.${result.engine === 'mymemory' ? getUsageWarning() : ''}`;
    renderHistory();
  } catch (error) {
    if (activeTranslation !== controller) {
      return;
    }
    const message = describeTranslationError(error, source);
    if (error instanceof TranslationError && INLINE_ERROR_CODES.has(error.code)) {
      translateStatus.textContent = message;
    } else {
      console.error('Çeviri yapılamadı:', error);
      showOutputError(message);
      translateStatus.textContent = '';
    }
  } finally {
    if (activeTranslation === controller) {
      activeTranslation = null;
      setBusy(false);
    }
  }
}

/* ---------- Seslendirme, kopyalama, paylaşma ---------- */

function setSpeakButtonState(button, isSpeaking) {
  button.textContent = isSpeaking ? '■' : '🔊';
  const baseLabel = button === speakSourceBtn ? 'Metni seslendir' : 'Çeviriyi seslendir';
  button.setAttribute('aria-label', isSpeaking ? 'Seslendirmeyi durdur' : baseLabel);
  button.title = isSpeaking ? 'Durdur' : 'Seslendir';
}

function stopSpeaking() {
  if ('speechSynthesis' in window && (speechSynthesis.speaking || speechSynthesis.pending)) {
    speechSynthesis.cancel();
  }
  if (activeSpeechButton) {
    setSpeakButtonState(activeSpeechButton, false);
    activeSpeechButton = null;
  }
}

function findVoice(lang) {
  const voices = speechSynthesis.getVoices();
  const wanted = lang.toLowerCase();
  const primary = wanted.split('-')[0];
  return (
    voices.find((voice) => voice.lang.toLowerCase().replace('_', '-') === wanted) ??
    voices.find((voice) => voice.lang.toLowerCase().split(/[-_]/)[0] === primary) ??
    null
  );
}

function speak(text, lang, button) {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
    translateStatus.textContent = 'Bu cihaz seslendirmeyi desteklemiyor.';
    return;
  }
  const wasActive = activeSpeechButton === button;
  stopSpeaking();
  if (wasActive || !text) {
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  if (lang) {
    const voice = findVoice(lang);
    // Ses listesi doluysa ama bu dilde ses yoksa, metin yanlış aksanla okunmasın diye durulur.
    if (!voice && speechSynthesis.getVoices().length > 0) {
      translateStatus.textContent = `Bu cihazda ${getLanguageName(lang)} için seslendirme sesi bulunamadı.`;
      return;
    }
    utterance.lang = voice?.lang ?? lang;
    if (voice) {
      utterance.voice = voice;
    }
  }
  const finish = () => {
    if (activeSpeechButton === button) {
      setSpeakButtonState(button, false);
      activeSpeechButton = null;
    }
  };
  utterance.addEventListener('end', finish);
  utterance.addEventListener('error', finish);
  activeSpeechButton = button;
  setSpeakButtonState(button, true);
  speechSynthesis.speak(utterance);
}

function getSourceSpeechLanguage() {
  if (sourceSelect.value !== AUTO_LANGUAGE) {
    return sourceSelect.value;
  }
  const entry = getCurrentEntry();
  return entry && entry.sourceText === sourceText.value.trim() ? normalizeLanguageCode(entry.detectedLanguage) : null;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    // Eski tarayıcılar veya izin verilmeyen bağlamlar için yedek yöntem.
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.append(helper);
    helper.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (fallbackError) {
      console.error('Panoya kopyalanamadı:', error, fallbackError);
    }
    helper.remove();
    return copied;
  }
}

/* ---------- Geçmiş ---------- */

function getLanguagePairLabel(item) {
  let sourceLabel;
  if (item.source === AUTO_LANGUAGE) {
    const detected = normalizeLanguageCode(item.detectedLanguage);
    sourceLabel = detected ? `${getLanguageName(detected)} (algılandı)` : 'Algılandı';
  } else {
    sourceLabel = getLanguageName(item.source);
  }
  return `${sourceLabel} → ${getLanguageName(item.target)}`;
}

function formatDate(isoString) {
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) || date.getTime() === 0 ? '' : dateFormat.format(date);
}

function createHistoryItem(item) {
  const node = historyItemTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.id = item.id;
  node.classList.toggle('favorite', item.favorite);
  node.querySelector('.lang-badge').textContent = getLanguagePairLabel(item);
  node.querySelector('.history-date').textContent = formatDate(item.createdAt);

  const sourceNode = node.querySelector('.history-source');
  sourceNode.textContent = item.sourceText;
  const sourceLang = item.source === AUTO_LANGUAGE ? normalizeLanguageCode(item.detectedLanguage) : item.source;
  if (sourceLang) {
    sourceNode.lang = sourceLang;
  }
  sourceNode.dir = 'auto';

  const translationNode = node.querySelector('.history-translation');
  translationNode.textContent = item.translatedText;
  translationNode.lang = item.target;
  translationNode.dir = 'auto';

  const preview = item.sourceText.length > 40 ? `${item.sourceText.slice(0, 40)}…` : item.sourceText;
  node.querySelector('.open-btn').setAttribute('aria-label', `“${preview}” çevirisini aç`);
  node.querySelector('.delete-btn').setAttribute('aria-label', `“${preview}” çevirisini sil`);
  const favoriteToggle = node.querySelector('.favorite-toggle');
  favoriteToggle.textContent = item.favorite ? '★' : '☆';
  favoriteToggle.setAttribute('aria-pressed', String(item.favorite));
  favoriteToggle.setAttribute('aria-label', item.favorite ? `“${preview}” favorilerden çıkar` : `“${preview}” favorilere ekle`);
  favoriteToggle.title = item.favorite ? 'Favorilerden çıkar' : 'Favorilere ekle';
  return node;
}

function renderList(listElement, items, emptyMessage) {
  if (!items.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = emptyMessage;
    listElement.replaceChildren(empty);
    return;
  }
  listElement.replaceChildren(...items.map(createHistoryItem));
}

function renderHistory() {
  const query = historySearch.value;
  const visible = filterHistory(history, { query, favoritesOnly: historyFilter === 'favorites' });
  let emptyMessage = 'Henüz çeviri yapmadınız. Çevirileriniz burada listelenir.';
  if (query.trim()) {
    emptyMessage = 'Aramanızla eşleşen çeviri bulunamadı.';
  } else if (historyFilter === 'favorites') {
    emptyMessage = 'Henüz favori yok. Bir çeviriyi ☆ düğmesiyle favorilere ekleyebilirsiniz.';
  }
  renderList(historyList, visible, emptyMessage);
  renderList(recentList, history.slice(0, RECENT_COUNT), 'Henüz çeviri yok. İlk çevirinizi yukarıdan yapın.');

  const favoriteCount = history.filter((item) => item.favorite).length;
  historyCount.textContent = `${numberFormat.format(history.length)} çeviri · ${numberFormat.format(favoriteCount)} favori`;
  clearHistoryBtn.disabled = history.length === favoriteCount;
  historyFilters.forEach((button) => {
    const isActive = button.dataset.filter === historyFilter;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

function toggleFavorite(entryId) {
  history = history.map((item) => (item.id === entryId ? { ...item, favorite: !item.favorite } : item));
  saveHistory();
  renderHistory();
  updateFavoriteButton();
}

function deleteEntry(entryId) {
  history = history.filter((item) => item.id !== entryId);
  saveHistory();
  if (currentOutput?.entryId === entryId) {
    currentOutput = { ...currentOutput, entryId: null };
    updateFavoriteButton();
  }
  renderHistory();
}

function openEntry(entryId) {
  const entry = history.find((item) => item.id === entryId);
  if (!entry) {
    return;
  }
  sourceSelect.value = entry.source;
  targetSelect.value = entry.target;
  storeLanguageSelection();
  sourceText.value = entry.sourceText;
  updateCharCounter();
  scheduleDraftSave();
  showEntry(entry, { fromCache: true });
  translateStatus.textContent = 'Geçmişteki çeviri açıldı.';
  openPage('translate');
  sourceText.focus({ preventScroll: true });
}

function handleHistoryClick(event) {
  const button = event.target.closest('button');
  const itemNode = event.target.closest('.history-item');
  if (!button || !itemNode) {
    return;
  }
  const entryId = itemNode.dataset.id;
  if (button.classList.contains('open-btn')) {
    openEntry(entryId);
  } else if (button.classList.contains('favorite-toggle')) {
    toggleFavorite(entryId);
  } else if (button.classList.contains('delete-btn')) {
    deleteEntry(entryId);
  }
}

/* ---------- Ayarlar ---------- */

function applyTheme(theme, { persist = false } = {}) {
  const isDark = theme === 'dark';
  document.body.classList.toggle('dark-theme', isDark);
  themeToggleBtn.textContent = isDark ? 'Açık temayı aç' : 'Koyu temayı aç';
  if (persist) {
    writeStorage(THEME_STORAGE_KEY, theme);
  }
}

function getInitialTheme() {
  const stored = readStorage(THEME_STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') {
    return stored;
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function renderEngineSettings() {
  engineInputs.forEach((input) => {
    input.checked = input.value === settings.engine;
  });
  engineStatus.textContent = hasDeviceTranslator()
    ? 'Bu tarayıcı cihaz içi çeviriyi destekliyor. Modeli indirilmiş dil çiftleri internetsiz ve kota harcamadan çevrilir; diğerleri çevrimiçi yapılır.'
    : 'Bu tarayıcıda cihaz içi çeviri modeli yok; çeviriler çevrimiçi yapılır. Daha önce yaptığınız çeviriler geçmişten internetsiz de açılır.';
}

function renderUsage() {
  const used = readUsage(usage, todayKey());
  const limit = getDailyLimit(settings.email);
  usageMeter.max = limit;
  usageMeter.low = limit * 0.7;
  usageMeter.high = limit * 0.9;
  usageMeter.value = Math.min(used, limit);
  usageText.textContent = `Bugün ${numberFormat.format(used)} / ${numberFormat.format(limit)} karakter kullanıldı.`;
}

function renderEmailSettings() {
  emailInput.value = settings.email;
  clearEmailBtn.disabled = !settings.email;
}

/* ---------- Gezinme ---------- */

function openPage(pageName) {
  const selectedPanel = document.querySelector(`[data-page-panel="${pageName}"]`);
  const selectedLink = [...pageLinks].find((link) => link.dataset.openPage === pageName);
  if (!(selectedPanel instanceof HTMLElement) || !(selectedLink instanceof HTMLButtonElement)) {
    return;
  }

  pagePanels.forEach((panel) => {
    panel.hidden = panel !== selectedPanel;
  });
  pageLinks.forEach((link) => {
    if (link === selectedLink) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
  menuGroups.forEach((group) => {
    group.open = group.contains(selectedLink);
  });
  appMenuHint.textContent = `${selectedLink.querySelector('strong').textContent} açık`;
  if (appMenu.open) {
    appMenu.open = false;
    appMenuSummary.focus({ preventScroll: true });
  }
  selectedPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- Bağlantı ve çevrimdışı destek ---------- */

function isNativeApp() {
  return window.Capacitor?.isNativePlatform?.() === true;
}

function isIOSDevice() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isAppInstalled() {
  return navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
}

function updateConnectionLabel() {
  const online = navigator.onLine !== false;
  connectionLabel.textContent = online ? 'Çevrimiçi' : 'Çevrimdışı · geçmiş kullanılabilir';
  connectionLabel.classList.toggle('offline', !online);
}

async function registerOfflineSupport() {
  if (isNativeApp()) {
    installStatus.textContent = 'Uygulama paketi içinde çalışıyorsunuz. Geçmişiniz bu cihazda saklanır.';
    return;
  }
  if (!('serviceWorker' in navigator)) {
    installStatus.textContent = 'Bu tarayıcı çevrimdışı uygulama desteği sunmuyor. Geçmişiniz bu cihazda kayıtlıdır.';
    return;
  }

  // Geliştirme sunucusunda service worker eski dosyaları sunup değişiklikleri gizleyebilir.
  if (import.meta.env?.DEV) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    installStatus.textContent = 'Geliştirme modu: çevrimdışı önbellek devre dışı.';
    return;
  }

  try {
    await navigator.serviceWorker.register('./service-worker.js');
    await navigator.serviceWorker.ready;
    installStatus.textContent = isIOSDevice()
      ? isAppInstalled()
        ? 'Uygulama ana ekrandan açıldı. Arayüz ve geçmiş çevrimdışı da kullanılabilir.'
        : 'Uygulamayı HTTPS adresinde Safari ile açın. Paylaş düğmesine, ardından “Ana Ekrana Ekle” seçeneğine dokunun.'
      : 'Web uygulaması çevrimdışı kullanım için hazır. Yeni çeviriler için internet gerekir.';
  } catch (error) {
    console.error('Çevrimdışı uygulama desteği başlatılamadı:', error);
    installStatus.textContent = 'Çevrimdışı destek başlatılamadı. Uygulamayı güvenli bağlantı (HTTPS veya localhost) üzerinden açın.';
  }
}

/* ---------- Olaylar ---------- */

sourceSelect.addEventListener('change', handleSourceChange);
targetSelect.addEventListener('change', handleTargetChange);
swapBtn.addEventListener('click', swapLanguages);
translateBtn.addEventListener('click', handleTranslate);

sourceText.addEventListener('input', () => {
  updateCharCounter();
  scheduleDraftSave();
});
sourceText.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    handleTranslate();
  }
});

clearSourceBtn.addEventListener('click', () => {
  sourceText.value = '';
  updateCharCounter();
  scheduleDraftSave();
  resetOutput();
  translateStatus.textContent = '';
  sourceText.focus();
});

speakSourceBtn.addEventListener('click', () => {
  speak(sourceText.value.trim(), getSourceSpeechLanguage(), speakSourceBtn);
});
speakOutputBtn.addEventListener('click', () => {
  speak(currentOutput?.text ?? '', currentOutput?.lang ?? '', speakOutputBtn);
});

copyBtn.addEventListener('click', async () => {
  if (!currentOutput?.text) {
    return;
  }
  translateStatus.textContent = (await copyToClipboard(currentOutput.text))
    ? 'Çeviri panoya kopyalandı.'
    : 'Kopyalanamadı. Metni seçip elle kopyalayabilirsiniz.';
});

if (typeof navigator.share === 'function') {
  shareBtn.classList.remove('hidden');
  shareBtn.addEventListener('click', async () => {
    if (!currentOutput?.text) {
      return;
    }
    try {
      await navigator.share({ text: currentOutput.text });
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.error('Paylaşılamadı:', error);
        translateStatus.textContent = 'Paylaşım başlatılamadı.';
      }
    }
  });
}

favoriteBtn.addEventListener('click', () => {
  const entry = getCurrentEntry();
  if (!entry) {
    return;
  }
  toggleFavorite(entry.id);
  translateStatus.textContent = getCurrentEntry()?.favorite ? 'Favorilere eklendi.' : 'Favorilerden çıkarıldı.';
});

historyList.addEventListener('click', handleHistoryClick);
recentList.addEventListener('click', handleHistoryClick);

let searchRenderFrame = 0;
historySearch.addEventListener('input', () => {
  cancelAnimationFrame(searchRenderFrame);
  searchRenderFrame = requestAnimationFrame(renderHistory);
});

historyFilters.forEach((button) => {
  button.addEventListener('click', () => {
    historyFilter = button.dataset.filter;
    renderHistory();
  });
});

clearHistoryBtn.addEventListener('click', () => {
  const removable = history.filter((item) => !item.favorite).length;
  if (!removable) {
    return;
  }
  // eslint-disable-next-line no-alert -- Toplu silme geri alınamaz; sistem onayı yeterli ve erişilebilir.
  if (!window.confirm(`${numberFormat.format(removable)} çeviri silinecek. Favoriler korunur. Devam edilsin mi?`)) {
    return;
  }
  history = history.filter((item) => item.favorite);
  saveHistory();
  if (currentOutput?.entryId && !getCurrentEntry()) {
    currentOutput = { ...currentOutput, entryId: null };
    updateFavoriteButton();
  }
  renderHistory();
});

document.querySelectorAll('[data-open-page]').forEach((button) => {
  button.addEventListener('click', () => openPage(button.dataset.openPage));
});

themeToggleBtn.addEventListener('click', () => {
  applyTheme(document.body.classList.contains('dark-theme') ? 'light' : 'dark', { persist: true });
});

engineInputs.forEach((input) => {
  input.addEventListener('change', () => {
    if (input.checked) {
      settings = { ...settings, engine: input.value === 'online' ? 'online' : 'auto' };
      saveSettings();
    }
  });
});

emailForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const email = emailInput.value.trim();
  if (!email) {
    emailStatus.textContent = 'Kaydetmek için bir e-posta adresi yazın ya da “Kaldır”ı kullanın.';
    return;
  }
  if (!EMAIL_PATTERN.test(email) || !emailInput.checkValidity()) {
    emailStatus.textContent = 'Geçerli bir e-posta adresi yazın.';
    emailInput.focus();
    return;
  }
  settings = { ...settings, email };
  saveSettings();
  renderEmailSettings();
  renderUsage();
  emailStatus.textContent = 'E-posta kaydedildi. Günlük sınır 50.000 karakter.';
});

clearEmailBtn.addEventListener('click', () => {
  settings = { ...settings, email: '' };
  saveSettings();
  renderEmailSettings();
  renderUsage();
  emailStatus.textContent = 'E-posta kaldırıldı. Günlük sınır 5.000 karakter.';
});

revokeConsentBtn.addEventListener('click', () => {
  settings = { ...settings, consent: false };
  saveSettings();
  updateConsentStatus();
});

consentAcceptBtn.addEventListener('click', () => finishConsent(true));
consentCancelBtn.addEventListener('click', () => finishConsent(false));
// Esc veya sistem tarafından kapatma "Şimdi değil" sayılır.
consentDialog.addEventListener('close', () => {
  if (pendingConsent) {
    finishConsent(false);
  }
});

window.addEventListener('online', updateConnectionLabel);
window.addEventListener('offline', updateConnectionLabel);

// Gün değişmiş olabilir: uygulamaya dönüldüğünde kota sayacı tazelenir. Uygulama arka plana
// alınır veya kapatılırken bekleyen taslak kaydı hemen yapılır (iOS'ta pagehide güvenilmezdir).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    renderUsage();
  } else if (draftTimer) {
    saveDraftNow();
  }
});
window.addEventListener('pagehide', () => {
  if (draftTimer) {
    saveDraftNow();
  }
});

/* ---------- Başlangıç ---------- */

function initializeApp() {
  // Tema ilk çizimden önce uygulanır; yanlış temanın bir an görünmesi önlenir.
  applyTheme(getInitialTheme());
  // Menü açıldığında geçerli sayfanın grubu açık gelir.
  const currentLink = document.querySelector('.menu-category[aria-current="page"]');
  menuGroups.forEach((group) => {
    group.open = group.contains(currentLink);
  });

  fillLanguageSelect(sourceSelect, { includeAuto: true });
  fillLanguageSelect(targetSelect, { includeAuto: false });
  sourceSelect.value = settings.source;
  targetSelect.value = settings.target;
  applyLanguageAttributes();

  sourceText.value = readStorage(DRAFT_STORAGE_KEY) ?? '';
  updateCharCounter();
  resetOutput();

  renderHistory();
  renderEngineSettings();
  renderUsage();
  renderEmailSettings();
  updateConsentStatus();
  updateConnectionLabel();
  registerOfflineSupport();
}

initializeApp();
