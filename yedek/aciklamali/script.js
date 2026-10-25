const STORAGE_KEY = 'reminder-app-state-v1';
const THEME_STORAGE_KEY = 'reminder-theme';
const ALARM_STORAGE_KEY = 'reminder-alarm-audio-v1';
const ALARM_FILENAME_KEY = 'reminder-alarm-file-name-v1';
const ALARM_SETTINGS_KEY = 'reminder-alarm-settings-v1';
const MAX_ALARM_FILE_SIZE = 1024 * 1024;
const NOTIFICATION_LEAD_TIMES = [
  { minutes: 1440, label: '1 gün kaldı' },
  { minutes: 60, label: '1 saat kaldı' },
  { minutes: 30, label: '30 dakika kaldı' },
  { minutes: 10, label: '10 dakika kaldı' },
  { minutes: 5, label: '5 dakika kaldı' },
  { minutes: 0, label: 'Hatırlatma zamanı' },
];
const NOTIFICATION_SCHEDULE_DESCRIPTION =
  'Bildirimler 1 gün, 1 saat, 30 dakika, 10 dakika ve 5 dakika önce; ayrıca hatırlatma saatinde gönderilir.';
const reminderForm = document.getElementById('reminder-form');
const reminderList = document.getElementById('reminder-list');
const statsContainer = document.getElementById('stats');
const remindTemplate = document.getElementById('reminder-template');
const notifyBtn = document.getElementById('notify-btn');
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const filters = document.querySelectorAll('.filter-btn');
const searchInput = document.getElementById('search-input');
const clearCompletedBtn = document.getElementById('clear-completed-btn');
const formTitle = document.getElementById('form-title');
const submitBtn = document.getElementById('submit-btn');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
const recurrenceInput = document.getElementById('recurrence');
const recurrenceOptions = document.getElementById('recurrence-options');
const recurrenceIntervalInput = document.getElementById('recurrence-interval');
const recurrenceEndModeInput = document.getElementById('recurrence-end-mode');
const recurrenceCountField = document.getElementById('recurrence-count-field');
const recurrenceCountInput = document.getElementById('recurrence-count');
const recurrenceEndDateField = document.getElementById('recurrence-end-date-field');
const recurrenceEndDateInput = document.getElementById('recurrence-end-date');
const alarmFileInput = document.getElementById('alarm-file');
const alarmFileName = document.getElementById('alarm-file-name');
const alarmEnabledInput = document.getElementById('alarm-enabled');
const alarmVolumeInput = document.getElementById('alarm-volume');
const alarmVolumeValue = document.getElementById('alarm-volume-value');
const previewAlarmBtn = document.getElementById('preview-alarm-btn');
const clearAlarmBtn = document.getElementById('clear-alarm-btn');
const stopAlarmBtn = document.getElementById('stop-alarm-btn');
const alarmStatus = document.getElementById('alarm-status');
const pageLinks = document.querySelectorAll('.menu-category[data-open-page]');
const pagePanels = document.querySelectorAll('[data-page-panel]');
const overviewList = document.getElementById('overview-list');
const notificationStatus = document.getElementById('notification-status');
const todayLabel = document.getElementById('today-label');
const installStatus = document.getElementById('install-status');
const appMenu = document.getElementById('app-menu');
const appMenuSummary = appMenu.querySelector(':scope > summary');
const appMenuHint = document.getElementById('app-menu-hint');
const menuGroups = document.querySelectorAll('.menu-group');
const permissionExplanationDialog = document.getElementById('permission-explanation-dialog');
const permissionExplanationTitle = document.getElementById('permission-explanation-title');
const permissionExplanationDescription = document.getElementById('permission-explanation-description');
const permissionCancelBtn = document.getElementById('permission-cancel-btn');
const permissionConsentBtn = document.getElementById('permission-consent-btn');

let activeFilter = 'all';
let editingReminderId = null;
let customAlarmData = localStorage.getItem(ALARM_STORAGE_KEY) || '';
let activeAlarm = null;
let reminders = loadReminders();
let nativeNotificationSync = Promise.resolve();
let nativeWidgetSync = Promise.resolve();
let pendingPermissionRequest = null;
let allowAlarmFilePickerClick = false;

// Capacitor'ı yalnızca gerçek iOS kabuğunda kullan; web/PWA bildirim akışı değişmez.
function isNativeIOSApp() {
  return window.Capacitor?.isNativePlatform?.() === true &&
    window.Capacitor?.getPlatform?.() === 'ios';
}

function getNativeLocalNotifications() {
  return import('@capacitor/local-notifications').then(
    ({ LocalNotifications }) => LocalNotifications
  );
}

function getNativeWidgetBridge() {
  return import('@hatirlaticilarim/widget-bridge').then(
    ({ WidgetBridge }) => WidgetBridge
  );
}

function loadReminders() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    return [
      {
        id: crypto.randomUUID(),
        title: 'Günlük kontrolü tamamla',
        details: 'Öncelikli görevleri gözden geçir.',
        dueAt: new Date(Date.now() + 1000 * 60 * 60 * 2).toISOString(),
        priority: 'important',
        category: 'iş',
        completed: false,
        notified: false,
        notifiedStages: [],
        soundPlayed: false,
      },
      {
        id: crypto.randomUUID(),
        title: 'Alışveriş listesi',
        details: 'Yumurta, süt ve kahve al.',
        dueAt: new Date(Date.now() + 1000 * 60 * 60 * 26).toISOString(),
        priority: 'normal',
        category: 'alışveriş',
        completed: false,
        notified: false,
        soundPlayed: false,
      },
    ];
  }

  try {
    return JSON.parse(saved);
  } catch (error) {
    console.error('Kaydedilen veriler okunamadı:', error);
    return [];
  }
}

function saveReminders() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reminders));
  nativeWidgetSync = nativeWidgetSync
    .then(synchronizeNativeWidget)
    .catch((error) => {
      console.error('iOS widget bilgileri güncellenemedi:', error);
      notificationStatus.textContent = 'Widget bilgileri güncellenemedi. Uygulamayı yeniden açıp tekrar deneyin.';
    });
  nativeNotificationSync = nativeNotificationSync
    .then(synchronizeNativeNotifications)
    .catch((error) => {
      console.error('iOS hatırlatma bildirimleri eşitlenemedi:', error);
      notificationStatus.textContent = 'iOS bildirimleri güncellenemedi. İzinleri Ayarlar bölümünden kontrol edin.';
    });
}

function parseLocalDateTime(dateValue, timeValue) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const [hours, minutes] = timeValue.split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0);
}

function formatDateTime(dateString) {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function dateToInputValue(dateString) {
  const date = new Date(dateString);
  const pad = (value) => String(value).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

function getRecurrenceLabel(recurrence, recurrenceInterval = 1) {
  if (recurrence === 'none') {
    return '';
  }
  const interval = Math.max(1, Number(recurrenceInterval) || 1);
  const units = {
    daily: interval === 1 ? 'Her gün' : `${interval} günde bir`,
    weekdays: interval === 1 ? 'Her hafta içi' : `${interval} iş gününde bir`,
    weekly: interval === 1 ? 'Her hafta' : `${interval} haftada bir`,
    monthly: interval === 1 ? 'Her ay' : `${interval} ayda bir`,
  };
  return units[recurrence] || '';
}

function updateRecurrenceOptions() {
  const isRepeating = recurrenceInput.value !== 'none';
  recurrenceOptions.classList.toggle('hidden', !isRepeating);

  const endMode = recurrenceEndModeInput.value;
  recurrenceCountField.classList.toggle('hidden', endMode !== 'count');
  recurrenceEndDateField.classList.toggle('hidden', endMode !== 'date');
  recurrenceEndDateInput.required = isRepeating && endMode === 'date';
}

function getRecurrenceEndTimestamp(dateValue) {
  if (!dateValue) {
    return null;
  }
  const [year, month, day] = dateValue.split('-').map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

function getNextOccurrence(reminder, fromDate = new Date()) {
  const next = new Date(reminder.dueAt);
  const recurrence = reminder.recurrence || 'none';
  const anchorDay = reminder.recurrenceDay || next.getDate();
  const interval = Math.max(1, Number(reminder.recurrenceInterval) || 1);

  function advanceOneOccurrence() {
    if (recurrence === 'daily') {
      next.setDate(next.getDate() + interval);
    } else if (recurrence === 'weekdays') {
      let workdaysToAdvance = interval;
      while (workdaysToAdvance > 0) {
        next.setDate(next.getDate() + 1);
        if (next.getDay() !== 0 && next.getDay() !== 6) {
          workdaysToAdvance -= 1;
        }
      }
    } else if (recurrence === 'weekly') {
      next.setDate(next.getDate() + 7 * interval);
    } else if (recurrence === 'monthly') {
      next.setDate(1);
      next.setMonth(next.getMonth() + interval);
      const lastDayOfMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      next.setDate(Math.min(anchorDay, lastDayOfMonth));
    }
  }

  while (next.getTime() <= fromDate.getTime()) {
    advanceOneOccurrence();
  }

  return next.toISOString();
}

function resetFormState() {
  editingReminderId = null;
  formTitle.textContent = 'Yeni Hatırlatma';
  submitBtn.textContent = 'Hatırlatıcı ekle';
  cancelEditBtn.classList.add('hidden');
  recurrenceOptions.open = false;
  updateRecurrenceOptions();
}

function getDueStatus(reminder) {
  const now = Date.now();
  const dueAt = new Date(reminder.dueAt).getTime();

  if (reminder.completed) return 'done';
  if (dueAt < now) return 'missed';
  if (dueAt - now <= 1000 * 60 * 60 * 24) return 'upcoming';
  return 'future';
}

function getCounts() {
  return {
    total: reminders.length,
    today: reminders.filter((item) => {
      const date = new Date(item.dueAt);
      const now = new Date();
      return !item.completed && date.toDateString() === now.toDateString();
    }).length,
    pending: reminders.filter((item) => !item.completed).length,
    done: reminders.reduce(
      (count, item) =>
        count +
        (typeof item.completedOccurrences === 'number'
          ? item.completedOccurrences
          : item.completed
            ? 1
            : 0),
      0
    ),
  };
}

function renderStats() {
  const counts = getCounts();

  statsContainer.innerHTML = `
    <div class="stat-card">
      <p>Toplam hatırlatma</p>
      <strong>${counts.total}</strong>
    </div>
    <div class="stat-card">
      <p>Bugün yapılacak</p>
      <strong>${counts.today}</strong>
    </div>
    <div class="stat-card">
      <p>Bekleyen</p>
      <strong>${counts.pending}</strong>
    </div>
    <div class="stat-card">
      <p>Tamamlanan</p>
      <strong>${counts.done}</strong>
    </div>
  `;
}

function getPriorityLabel(priority) {
  const labels = {
    normal: 'Normal',
    important: 'Önemli',
    urgent: 'Acil',
  };
  return labels[priority] || 'Normal';
}

function getCategoryLabel(category) {
  const labels = {
    genel: 'Genel',
    iş: 'İş',
    kişisel: 'Kişisel',
    alışveriş: 'Alışveriş',
  };
  return labels[category] || category || 'Genel';
}

function renderOverview() {
  const upcoming = [...reminders]
    .filter((reminder) => !reminder.completed)
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))
    .slice(0, 5);

  overviewList.replaceChildren();
  if (upcoming.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'Henüz bekleyen hatırlatma yok.';
    overviewList.appendChild(empty);
    return;
  }

  upcoming.forEach((reminder) => {
    const item = document.createElement('li');
    item.className = 'overview-reminder';
    const copy = document.createElement('div');
    copy.className = 'overview-reminder-copy';
    const title = document.createElement('strong');
    title.textContent = reminder.title;
    const meta = document.createElement('span');
    meta.textContent = `${formatDateTime(reminder.dueAt)} · ${getCategoryLabel(reminder.category)}`;
    const priority = document.createElement('span');
    priority.className = `badge ${reminder.priority}`;
    priority.textContent = getPriorityLabel(reminder.priority);
    copy.append(title, meta);
    item.append(copy, priority);
    overviewList.appendChild(item);
  });
}

function renderReminders() {
  const now = Date.now();
  const searchQuery = searchInput.value.trim().toLowerCase();

  const visible = [...reminders]
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))
    .filter((item) => {
      const matchesSearch = !searchQuery || item.title.toLowerCase().includes(searchQuery) || (item.details || '').toLowerCase().includes(searchQuery);

      if (!matchesSearch) {
        return false;
      }

      if (activeFilter === 'all') return true;
      if (activeFilter === 'done') return item.completed;
      if (activeFilter === 'today') {
        const itemDate = new Date(item.dueAt);
        const today = new Date();
        return !item.completed && itemDate.toDateString() === today.toDateString();
      }
      if (activeFilter === 'upcoming') {
        if (item.completed) return false;
        return new Date(item.dueAt).getTime() > now;
      }
      if (activeFilter === 'overdue') {
        return !item.completed && new Date(item.dueAt).getTime() < now;
      }
      return true;
    });

  reminderList.innerHTML = '';

  if (visible.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'Gösterilecek hatırlatma yok.';
    reminderList.appendChild(empty);
    renderStats();
    return;
  }

  visible.forEach((item) => {
    const fragment = remindTemplate.content.cloneNode(true);
    const itemNode = fragment.querySelector('.reminder-item');
    const checkbox = fragment.querySelector('.reminder-check');
    const title = fragment.querySelector('.reminder-title');
    const details = fragment.querySelector('.reminder-details');
    const badge = fragment.querySelector('.badge');
    const dateText = fragment.querySelector('.reminder-date');
    const category = fragment.querySelector('.reminder-category');
    const repeatText = fragment.querySelector('.reminder-repeat');
    const deleteBtn = fragment.querySelector('.delete-btn');
    const editBtn = fragment.querySelector('.edit-btn');

    itemNode.dataset.id = item.id;
    itemNode.classList.toggle('done', item.completed);
    itemNode.classList.toggle(item.priority, true);
    checkbox.checked = item.completed;
    title.textContent = item.title;
    details.textContent = item.details || 'Not eklenmedi.';
    badge.textContent = getPriorityLabel(item.priority);
    badge.classList.add(item.priority);
    dateText.textContent = formatDateTime(item.dueAt);
    category.textContent = getCategoryLabel(item.category);
    repeatText.textContent = getRecurrenceLabel(item.recurrence, item.recurrenceInterval);
    repeatText.classList.toggle('hidden', !repeatText.textContent);

    if (item.completed) {
      title.style.textDecoration = 'line-through';
    }

    checkbox.addEventListener('change', () => {
      reminders = reminders.map((reminder) => {
        if (reminder.id !== item.id) {
          return reminder;
        }
        if (checkbox.checked && reminder.recurrence && reminder.recurrence !== 'none') {
          const completedOccurrences = (reminder.completedOccurrences || 0) + 1;
          const nextOccurrence = getNextOccurrence(reminder);
          const repeatLimitReached =
            reminder.recurrenceEndMode === 'count' &&
            (reminder.completedOccurrences || 0) >= Number(reminder.recurrenceEndCount);
          const endTimestamp = getRecurrenceEndTimestamp(reminder.recurrenceEndDate);
          const endDateReached = endTimestamp !== null && new Date(nextOccurrence).getTime() > endTimestamp;

          if (repeatLimitReached || endDateReached) {
            return {
              ...reminder,
              completed: true,
              notified: true,
              soundPlayed: true,
              completedOccurrences,
            };
          }

          return {
            ...reminder,
            dueAt: nextOccurrence,
            notified: false,
            notifiedStages: getElapsedLeadStages(nextOccurrence),
            soundPlayed: false,
            completedOccurrences,
          };
        }
        return {
          ...reminder,
          completed: checkbox.checked,
          notified: checkbox.checked ? true : reminder.notified,
          soundPlayed: checkbox.checked ? true : reminder.soundPlayed,
        };
      });
      saveReminders();
      render();
    });

    editBtn.addEventListener('click', () => {
      const reminder = reminders.find((entry) => entry.id === item.id);
      if (!reminder) return;

      const { date, time } = dateToInputValue(reminder.dueAt);
      document.getElementById('title').value = reminder.title;
      document.getElementById('details').value = reminder.details || '';
      document.getElementById('date').value = date;
      document.getElementById('time').value = time;
      recurrenceInput.value = reminder.recurrence || 'none';
      recurrenceOptions.open = Boolean(reminder.recurrence && reminder.recurrence !== 'none');
      recurrenceIntervalInput.value = String(reminder.recurrenceInterval || 1);
      recurrenceEndModeInput.value = reminder.recurrenceEndMode || 'never';
      recurrenceCountInput.value = String(reminder.recurrenceEndCount || 10);
      recurrenceEndDateInput.value = reminder.recurrenceEndDate || '';
      updateRecurrenceOptions();
      document.getElementById('priority').value = reminder.priority;
      document.getElementById('category').value = reminder.category;

      editingReminderId = reminder.id;
      formTitle.textContent = 'Hatırlatma Düzenle';
      submitBtn.textContent = 'Değişiklikleri kaydet';
      cancelEditBtn.classList.remove('hidden');
      document.getElementById('title').focus();
    });

    deleteBtn.addEventListener('click', () => {
      reminders = reminders.filter((reminder) => reminder.id !== item.id);
      saveReminders();
      if (editingReminderId === item.id) {
        resetFormState();
        reminderForm.reset();
      }
      render();
    });

    reminderList.appendChild(fragment);
  });

  renderStats();
}

function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.body.classList.toggle('dark-theme', isDark);
  themeToggleBtn.textContent = isDark ? 'Açık temayı aç' : 'Koyu temayı aç';
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

function render() {
  renderReminders();
  renderOverview();
  updateFilterButtons();
}

function openPage(pageName) {
  const selectedPanel = document.querySelector(`[data-page-panel="${pageName}"]`);
  const selectedLink = [...pageLinks].find((link) => link.dataset.openPage === pageName);
  if (!(selectedPanel instanceof HTMLElement) || !(selectedLink instanceof HTMLButtonElement)) {
    return;
  }

  // Gezinme menüsü kapansa da seçili sayfa menünün dışında görünür kalır.
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
  appMenu.open = false;
  appMenuSummary.focus({ preventScroll: true });
  selectedPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateFilterButtons() {
  filters.forEach((button) => {
    button.classList.toggle('active', button.dataset.filter === activeFilter);
  });
}

async function synchronizeNativeNotifications() {
  if (!isNativeIOSApp()) {
    return;
  }

  const notifications = await getNativeLocalNotifications();
  const permission = await notifications.checkPermissions();
  if (permission.display !== 'granted') {
    return;
  }

  const pending = await notifications.getPending();
  const appNotifications = pending.notifications.filter(
    (item) => item.extra?.source === 'hatirlaticilarim'
  );
  if (appNotifications.length) {
    await notifications.cancel({
      notifications: appNotifications.map(({ id }) => ({ id })),
    });
  }

  // iOS bekleyen bildirim sınırını aşmamak için en yakın 64 kaydı sıraya al.
  const now = Date.now();
  const scheduled = reminders
    .filter((reminder) => !reminder.completed)
    .flatMap((reminder) => {
      const dueAt = new Date(reminder.dueAt).getTime();
      return NOTIFICATION_LEAD_TIMES
        .map((stage) => ({
          reminder,
          stage,
          at: dueAt - stage.minutes * 60 * 1000,
        }))
        .filter(({ at }) => at > now)
        .map(({ reminder: item, stage, at }) => ({
          id: getNativeNotificationId(item.id, stage.minutes),
          title: stage.minutes === 0 ? 'Hatırlatma zamanı' : 'Yaklaşan hatırlatma',
          body: stage.minutes === 0 ? item.title : `${item.title} · ${stage.label}`,
          schedule: { at: new Date(at) },
          extra: {
            source: 'hatirlaticilarim',
            reminderId: item.id,
            minutesBefore: stage.minutes,
          },
        }));
    })
    .sort((first, second) => first.schedule.at.getTime() - second.schedule.at.getTime())
    .slice(0, 64);

  if (scheduled.length) {
    await notifications.schedule({ notifications: scheduled });
  }
}

async function synchronizeNativeWidget() {
  if (!isNativeIOSApp()) {
    return;
  }

  const widgetBridge = await getNativeWidgetBridge();
  // Başlık ve tarih App Group'a kopyalanır; kilit ekranında hatırlatma başlığı görünür.
  await widgetBridge.syncReminders({
    reminders: reminders.map(({ id, title, dueAt, completed }) => ({
      id,
      title,
      dueAt,
      completed,
    })),
  });
}

function getNativeNotificationId(reminderId, minutesBefore) {
  let hash = 0;
  for (const character of `${reminderId}:${minutesBefore}`) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return (hash % 2147483646) + 1;
}

function updateAlarmControls() {
  const hasCustomAlarm = Boolean(customAlarmData);
  previewAlarmBtn.disabled = !hasCustomAlarm;
  clearAlarmBtn.disabled = !hasCustomAlarm;
  alarmFileName.textContent = hasCustomAlarm
    ? localStorage.getItem(ALARM_FILENAME_KEY) || 'Özel alarm sesi hazır.'
    : 'Henüz ses dosyası seçilmedi.';
  alarmVolumeValue.textContent = `${Math.round(Number(alarmVolumeInput.value) * 100)}%`;
}

function loadAlarmSettings() {
  const savedSettings = localStorage.getItem(ALARM_SETTINGS_KEY);
  if (!savedSettings) {
    return;
  }

  try {
    const settings = JSON.parse(savedSettings);
    if (typeof settings.enabled === 'boolean') {
      alarmEnabledInput.checked = settings.enabled;
    }
    if (typeof settings.volume === 'number' && settings.volume >= 0 && settings.volume <= 1) {
      alarmVolumeInput.value = String(settings.volume);
    }
  } catch (error) {
    console.error('Alarm ayarları okunamadı:', error);
  }
}

function saveAlarmSettings() {
  try {
    localStorage.setItem(
      ALARM_SETTINGS_KEY,
      JSON.stringify({
        enabled: alarmEnabledInput.checked,
        volume: Number(alarmVolumeInput.value),
      })
    );
  } catch (error) {
    console.error('Alarm ayarları kaydedilemedi:', error);
    alarmStatus.textContent = 'Alarm ayarları kaydedilemedi.';
  }
}

function stopAlarm(showStatus = true) {
  if (activeAlarm) {
    activeAlarm.pause();
    activeAlarm.currentTime = 0;
    activeAlarm = null;
  }
  stopAlarmBtn.classList.add('hidden');

  if (showStatus) {
    alarmStatus.textContent = 'Alarm sesi durduruldu.';
  }
}

async function playAlarm() {
  if (!customAlarmData || !alarmEnabledInput.checked) {
    return false;
  }

  stopAlarm(false);
  const audio = new Audio(customAlarmData);
  audio.loop = true;
  audio.playsInline = true;
  audio.preload = 'auto';
  audio.volume = Number(alarmVolumeInput.value);
  activeAlarm = audio;

  try {
    await audio.play();
    stopAlarmBtn.classList.remove('hidden');
    alarmStatus.textContent = 'Alarm sesi çalıyor.';
    return true;
  } catch (error) {
    console.error('Alarm sesi çalınamadı:', error);
    activeAlarm = null;
    alarmStatus.textContent = 'Tarayıcı sesi engelledi. Önce “Alarmı test et” düğmesine basın.';
    return false;
  }
}

function markSoundPlayed(reminderIds) {
  const ids = new Set(reminderIds);
  reminders = reminders.map((reminder) =>
    ids.has(reminder.id) ? { ...reminder, soundPlayed: true } : reminder
  );
  saveReminders();
}

function checkDueAlarm() {
  if (!alarmEnabledInput.checked || !customAlarmData) {
    return;
  }

  const dueReminders = reminders.filter(
    (reminder) =>
      !reminder.completed &&
      !reminder.soundPlayed &&
      new Date(reminder.dueAt).getTime() <= Date.now()
  );

  if (dueReminders.length === 0) {
    return;
  }

  const dueIds = dueReminders.map((reminder) => reminder.id);
  if (activeAlarm) {
    markSoundPlayed(dueIds);
    return;
  }

  playAlarm().then((started) => {
    if (started) {
      markSoundPlayed(dueIds);
    }
  });
}

function handleAlarmFileChange() {
  const file = alarmFileInput.files[0];
  if (!file) {
    return;
  }

  if (!file.type.startsWith('audio/')) {
    alarmStatus.textContent = 'Lütfen geçerli bir ses dosyası seçin.';
    alarmFileInput.value = '';
    return;
  }

  if (file.size > MAX_ALARM_FILE_SIZE) {
    alarmStatus.textContent = 'Ses dosyası 1 MB sınırını aşmamalı.';
    alarmFileInput.value = '';
    return;
  }

  const reader = new FileReader();
  reader.addEventListener('load', () => {
    if (typeof reader.result !== 'string') {
      alarmStatus.textContent = 'Ses dosyası okunamadı.';
      return;
    }

    try {
      localStorage.setItem(ALARM_STORAGE_KEY, reader.result);
      localStorage.setItem(ALARM_FILENAME_KEY, file.name);
      customAlarmData = reader.result;
      updateAlarmControls();
      alarmStatus.textContent = 'Özel alarm sesi kaydedildi.';
    } catch (error) {
      console.error('Alarm sesi kaydedilemedi:', error);
      alarmStatus.textContent = 'Ses kaydedilemedi. Tarayıcı depolama alanı dolu olabilir.';
    }
  });
  reader.addEventListener('error', () => {
    alarmStatus.textContent = 'Ses dosyası okunamadı.';
  });
  reader.readAsDataURL(file);
}

function clearCustomAlarm() {
  stopAlarm(false);
  localStorage.removeItem(ALARM_STORAGE_KEY);
  localStorage.removeItem(ALARM_FILENAME_KEY);
  customAlarmData = '';
  alarmFileInput.value = '';
  updateAlarmControls();
  alarmStatus.textContent = 'Özel alarm sesi kaldırıldı.';
}

function getNotifiedStages(reminder) {
  const savedStages = Array.isArray(reminder.notifiedStages)
    ? reminder.notifiedStages.filter((stage) =>
        NOTIFICATION_LEAD_TIMES.some((item) => item.minutes === stage)
      )
    : [];
  return reminder.notified && !savedStages.includes(0)
    ? [...savedStages, 0]
    : savedStages;
}

function getElapsedLeadStages(dueAt, now = Date.now()) {
  const dueTimestamp = new Date(dueAt).getTime();
  return NOTIFICATION_LEAD_TIMES
    .filter(
      (stage) =>
        stage.minutes > 0 &&
        dueTimestamp - stage.minutes * 60 * 1000 <= now
    )
    .map((stage) => stage.minutes);
}

function initializeNotificationStages() {
  let changed = false;
  reminders = reminders.map((reminder) => {
    if (reminder.completed) {
      return reminder;
    }

    const existingStages = getNotifiedStages(reminder);
    const notifiedStages = [...new Set([
      ...existingStages,
      ...getElapsedLeadStages(reminder.dueAt),
    ])];
    if (
      notifiedStages.length === existingStages.length &&
      notifiedStages.every((stage, index) => stage === existingStages[index])
    ) {
      return reminder;
    }

    changed = true;
    return { ...reminder, notifiedStages };
  });

  if (changed) {
    saveReminders();
  }
}

function setReminderNotification(reminder, stage) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  const notifiedStages = getNotifiedStages(reminder);
  if (notifiedStages.includes(stage.minutes)) {
    return;
  }

  const dueAt = new Date(reminder.dueAt).getTime();
  const now = Date.now();
  // Uygulama geri açıldığında eski uyarıları toplu göndermek yerine yalnızca en güncel aşamayı gönder.
  const elapsedStages = NOTIFICATION_LEAD_TIMES.filter(
    (item) => dueAt - item.minutes * 60 * 1000 <= now
  ).map((item) => item.minutes);
  const currentStage = [...NOTIFICATION_LEAD_TIMES]
    .reverse()
    .find((item) => elapsedStages.includes(item.minutes));
  const newlyElapsedStages = NOTIFICATION_LEAD_TIMES
    .filter(
      (item) =>
        elapsedStages.includes(item.minutes) &&
        !notifiedStages.includes(item.minutes)
    )
    .map((item) => item.minutes);
  const nextNotifiedStages = [...new Set([...notifiedStages, ...newlyElapsedStages])];

  const shouldSend = currentStage && currentStage.minutes === stage.minutes;
  if (shouldSend) {
    try {
      new Notification(stage.minutes === 0 ? 'Hatırlatma zamanı' : 'Yaklaşan hatırlatma', {
        body: stage.minutes === 0
          ? reminder.title
          : `${reminder.title} · ${stage.label}`,
        tag: `${reminder.id}-${stage.minutes}`,
      });
    } catch (error) {
      console.error('Hatırlatma bildirimi gösterilemedi:', error);
      notificationStatus.textContent = 'Hatırlatma bildirimi gösterilemedi. Tarayıcı bildirim izinlerini kontrol edin.';
      return;
    }
  }

  reminders = reminders.map((item) =>
    item.id === reminder.id
      ? {
          ...item,
          notified: nextNotifiedStages.includes(0),
          notifiedStages: nextNotifiedStages,
        }
      : item
  );
  saveReminders();
}

function checkDueReminders() {
  const now = Date.now();
  reminders.forEach((reminder) => {
    if (reminder.completed) {
      return;
    }

    const dueAt = new Date(reminder.dueAt).getTime();
    const notifiedStages = getNotifiedStages(reminder);
    const stage = [...NOTIFICATION_LEAD_TIMES]
      .reverse()
      .find(
        (item) =>
          dueAt - item.minutes * 60 * 1000 <= now &&
          !notifiedStages.includes(item.minutes)
      );
    if (stage) {
      setReminderNotification(reminder, stage);
    }
  });
  checkDueAlarm();
}

function showPermissionExplanation({ title, description, onConfirm, onCancel }) {
  if (permissionExplanationDialog.open) {
    return;
  }

  permissionExplanationTitle.textContent = title;
  permissionExplanationDescription.textContent = description;
  pendingPermissionRequest = { onConfirm, onCancel };
  permissionExplanationDialog.showModal();
}

function runPermissionCallback(callback) {
  if (!callback) {
    return;
  }

  try {
    const result = callback();
    if (result && typeof result.catch === 'function') {
      result.catch((error) => {
        console.error('Cihaz izni isteği başlatılamadı:', error);
        notificationStatus.textContent = 'İzin isteği başlatılamadı. Daha sonra yeniden deneyin.';
      });
    }
  } catch (error) {
    console.error('Cihaz izni isteği başlatılamadı:', error);
    notificationStatus.textContent = 'İzin isteği başlatılamadı. Daha sonra yeniden deneyin.';
  }
}

function finishPermissionExplanation(confirmed) {
  const pendingRequest = pendingPermissionRequest;
  pendingPermissionRequest = null;
  permissionExplanationDialog.close(confirmed ? 'confirmed' : 'cancelled');
  runPermissionCallback(confirmed ? pendingRequest?.onConfirm : pendingRequest?.onCancel);
}

permissionConsentBtn.addEventListener('click', () => finishPermissionExplanation(true));
permissionCancelBtn.addEventListener('click', () => finishPermissionExplanation(false));
permissionExplanationDialog.addEventListener('close', () => {
  const pendingRequest = pendingPermissionRequest;
  if (!pendingRequest) {
    return;
  }

  pendingPermissionRequest = null;
  runPermissionCallback(pendingRequest.onCancel);
});
permissionExplanationDialog.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    finishPermissionExplanation(false);
  }
});

function updateNotificationPermissionResult(permission) {
  if (permission === 'granted') {
    notifyBtn.textContent = 'Bildirim izni verildi';
    notificationStatus.textContent = isNativeIOSApp()
      ? `${NOTIFICATION_SCHEDULE_DESCRIPTION} iOS en fazla 64 yaklaşan bildirimi sıraya alır.`
      : `${NOTIFICATION_SCHEDULE_DESCRIPTION} Web bildirimleri uygulama açıkken kontrol edilir.`;
    if (isNativeIOSApp()) {
      return synchronizeNativeNotifications();
    }
    checkDueReminders();
    return Promise.resolve();
  }

  notifyBtn.textContent = permission === 'denied' ? 'Bildirim izni engellendi' : 'Bildirim izni ver';
  notificationStatus.textContent = permission === 'denied'
    ? isNativeIOSApp() || isIOSDevice()
      ? 'Bildirim izni engellendi. Yeniden etkinleştirmek için iPhone Ayarlar > Bildirimler bölümünden bu uygulamaya izin verin.'
      : 'Bildirim izni engellendi. Yeniden etkinleştirmek için tarayıcınızın site bildirim ayarlarından bu uygulamaya izin verin.'
    : 'Bildirim izni verilmedi. İsterseniz daha sonra yeniden deneyebilirsiniz.';
  return Promise.resolve();
}

async function requestNativeNotificationPermission() {
  const notifications = await getNativeLocalNotifications();
  const permission = await notifications.requestPermissions();
  await updateNotificationPermissionResult(permission.display);
}

function requestBrowserNotificationPermission() {
  Notification.requestPermission()
    .then(updateNotificationPermissionResult)
    .catch((error) => {
      console.error('Tarayıcı bildirim izni istenemedi:', error);
      notificationStatus.textContent = 'Bildirim izni istenemedi. Tarayıcı izinlerini kontrol edin.';
    });
}

function requestNotificationPermission() {
  if (isNativeIOSApp()) {
    getNativeLocalNotifications()
      .then(async (notifications) => {
        const permission = await notifications.checkPermissions();
        if (permission.display === 'granted') {
          await updateNotificationPermissionResult(permission.display);
          return;
        }

        if (permission.display === 'denied') {
          notifyBtn.textContent = 'Bildirim izni engellendi';
          notificationStatus.textContent = 'Bildirim izni engellendi. Yeniden etkinleştirmek için iPhone Ayarlar > Bildirimler bölümünden bu uygulamaya izin verin.';
          return;
        }

        showPermissionExplanation({
          title: 'Bildirim izni neden gerekli?',
          description: `Yaklaşan hatırlatmalarınız için iOS bildirimleri planlanır. ${NOTIFICATION_SCHEDULE_DESCRIPTION} iOS en fazla 64 yaklaşan bildirimi sıraya alabilir. “Devam et” seçeneğine dokunduğunuzda iPhone’un sistem izin penceresi açılır; “Şimdi değil” derseniz iOS’a izin isteği gönderilmez.`,
          onConfirm: requestNativeNotificationPermission,
          onCancel: () => {
            notificationStatus.textContent = 'İzin isteğiniz iptal edildi; iPhone’un sistem izin penceresi açılmadı.';
          },
        });
      })
      .catch((error) => {
        console.error('iOS bildirim izni durumu okunamadı:', error);
        notificationStatus.textContent = 'iOS bildirim izni durumu okunamadı. Daha sonra yeniden deneyin.';
      });
    return;
  }

  if (!('Notification' in window)) {
    notifyBtn.textContent = 'Bildirim desteklenmiyor';
    notifyBtn.disabled = true;
    notificationStatus.textContent = 'Bu tarayıcı bildirim özelliğini desteklemiyor.';
    return;
  }

  if (isIOSDevice() && !isAppInstalled()) {
    notificationStatus.textContent = 'iPhone’da bildirim için iOS/iPadOS 16.4 veya üzeri gerekir. HTTPS adresindeki uygulamayı Safari’den ana ekrana ekleyip oradan açın.';
    return;
  }

  if (Notification.permission === 'granted') {
    return updateNotificationPermissionResult(Notification.permission);
  }

  if (Notification.permission === 'denied') {
    notificationStatus.textContent = 'Bildirim izni engellenmiş. Yeniden etkinleştirmek için iPhone Ayarlar > Bildirimler (veya tarayıcı ayarları) bölümünden bu uygulamaya izin verin.';
    return;
  }

  showPermissionExplanation({
    title: 'Bildirim izni neden gerekli?',
    description: `${NOTIFICATION_SCHEDULE_DESCRIPTION} Web bildirimleri uygulama açıkken kontrol edilir. “Devam et” seçeneğine dokunduğunuzda tarayıcının bildirim izin penceresi açılır; “Şimdi değil” derseniz izin isteği gönderilmez.`,
    onConfirm: requestBrowserNotificationPermission,
    onCancel: () => {
      notificationStatus.textContent = 'İzin isteğiniz iptal edildi; tarayıcının izin penceresi açılmadı.';
    },
  });
}

function requestAlarmFileSelection() {
  showPermissionExplanation({
    title: 'Ses dosyası seçimi hakkında',
    description: 'Özel alarm sesi kullanmak için cihazınızdaki dosya seçiciden bir ses dosyası seçebilirsiniz. Uygulama yalnızca seçtiğiniz, en fazla 1 MB boyutundaki dosyayı okur ve bu cihazda saklar; fotoğraf arşivinizin tamamına erişmez. “Devam et” dosya seçiciyi açar, “Şimdi değil” seçimi iptal eder.',
    onConfirm: () => {
      allowAlarmFilePickerClick = true;
      alarmFileInput.click();
      allowAlarmFilePickerClick = false;
    },
    onCancel: () => {
      alarmStatus.textContent = 'Dosya seçimi iptal edildi; cihaz dosya seçicisi açılmadı.';
    },
  });
}

async function updateNotificationStatus() {
  if (isNativeIOSApp()) {
    const notifications = await getNativeLocalNotifications();
    const permission = await notifications.checkPermissions();
    if (permission.display === 'granted') {
      notifyBtn.textContent = 'Bildirim izni verildi';
      notificationStatus.textContent = `${NOTIFICATION_SCHEDULE_DESCRIPTION} iOS en fazla 64 yaklaşan bildirimi sıraya alır.`;
    } else {
      notifyBtn.textContent = 'Bildirim izni ver';
      notificationStatus.textContent = 'Bildirim almak için izin verin. İzin verildikten sonra yaklaşan hatırlatmalar planlanır.';
    }
    return;
  }

  if (!('Notification' in window)) {
    notifyBtn.textContent = 'Bildirim desteklenmiyor';
    notifyBtn.disabled = true;
    notificationStatus.textContent = 'Bu ortam bildirim özelliğini desteklemiyor.';
    return;
  }

  if (Notification.permission === 'granted') {
    notifyBtn.textContent = 'Bildirim izni verildi';
    notificationStatus.textContent = `${NOTIFICATION_SCHEDULE_DESCRIPTION} Web bildirimleri uygulama açıkken kontrol edilir.`;
  } else if (Notification.permission === 'denied') {
    notifyBtn.textContent = 'Bildirim izni engellendi';
    notificationStatus.textContent = 'Bildirim izni tarayıcı ayarlarından engellenmiş. Tarayıcı ayarlarından izin verebilirsiniz.';
  } else {
    notificationStatus.textContent = `Bildirim almak için izin verin. ${NOTIFICATION_SCHEDULE_DESCRIPTION} Web bildirimleri uygulama açıkken kontrol edilir.`;
  }
}

function isIOSDevice() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isAppInstalled() {
  return navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
}

async function registerOfflineSupport() {
  if (isNativeIOSApp()) {
    installStatus.textContent = 'iOS uygulama paketi içinde çalışıyorsunuz. Hatırlatmalarınız bu cihazda saklanır.';
    return;
  }

  if (!('serviceWorker' in navigator)) {
    installStatus.textContent = 'Bu tarayıcı çevrimdışı uygulama desteği sunmuyor. Hatırlatmalarınız bu cihazda kayıtlıdır.';
    return;
  }

  try {
    await navigator.serviceWorker.register('./service-worker.js');
    await navigator.serviceWorker.ready;
    installStatus.textContent = isIOSDevice()
      ? isAppInstalled()
        ? 'Uygulama ana ekrandan açıldı. Temel ekranlar çevrimdışı da kullanılabilir.'
        : 'Uygulamayı HTTPS adresinde Safari ile açın. Paylaş düğmesine, ardından “Ana Ekrana Ekle” seçeneğine dokunun. Çevrimdışı kullanım için uygulamayı en az bir kez çevrimiçiyken açın.'
      : 'Web uygulaması çevrimdışı kullanım için hazır.';
  } catch (error) {
    console.error('Çevrimdışı uygulama desteği başlatılamadı:', error);
    installStatus.textContent = 'Çevrimdışı destek başlatılamadı. Uygulamayı güvenli bağlantı (HTTPS veya localhost) üzerinden açın.';
  }
}

function handleFormSubmit(event) {
  event.preventDefault();

  const title = document.getElementById('title').value.trim();
  const details = document.getElementById('details').value.trim();
  const date = document.getElementById('date').value;
  const time = document.getElementById('time').value;
  const priority = document.getElementById('priority').value;
  const category = document.getElementById('category').value;
  const recurrence = recurrenceInput.value;
  const recurrenceInterval = Math.min(365, Math.max(1, Number(recurrenceIntervalInput.value) || 1));
  const recurrenceEndMode = recurrence === 'none' ? 'never' : recurrenceEndModeInput.value;
  const recurrenceEndCount =
    recurrenceEndMode === 'count'
      ? Math.min(999, Math.max(1, Number(recurrenceCountInput.value) || 1))
      : null;
  const recurrenceEndDate = recurrenceEndMode === 'date' ? recurrenceEndDateInput.value : '';

  if (!title || !date || !time) {
    return;
  }

  if (recurrenceEndMode === 'date' && !recurrenceEndDate) {
    recurrenceEndDateInput.focus();
    recurrenceEndDateInput.reportValidity();
    return;
  }

  const dueAt = parseLocalDateTime(date, time).toISOString();

  if (editingReminderId) {
    reminders = reminders.map((reminder) =>
      reminder.id === editingReminderId
      ? {
          ...reminder,
          title,
          details,
          dueAt,
          priority,
          category,
          recurrence,
          recurrenceInterval,
          recurrenceEndMode,
          recurrenceEndCount,
          recurrenceEndDate,
          recurrenceDay: parseLocalDateTime(date, time).getDate(),
          notified: false,
          notifiedStages: getElapsedLeadStages(dueAt),
          soundPlayed: false,
        }
        : reminder
    );
  } else {
    reminders.push({
      id: crypto.randomUUID(),
      title,
      details,
      dueAt,
      priority,
      category,
      recurrence,
      recurrenceInterval,
      recurrenceEndMode,
      recurrenceEndCount,
      recurrenceEndDate,
      recurrenceDay: parseLocalDateTime(date, time).getDate(),
      completed: false,
      notified: false,
      notifiedStages: getElapsedLeadStages(dueAt),
      soundPlayed: false,
    });
  }

  saveReminders();
  reminderForm.reset();
  resetFormState();
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  document.getElementById('date').value = `${year}-${month}-${day}`;
  render();
  openPage('reminders');
}

filters.forEach((button) => {
  button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    render();
  });
});

document.querySelectorAll('[data-open-page]').forEach((button) => {
  button.addEventListener('click', () => openPage(button.dataset.openPage));
});

document.getElementById('quick-add-btn').addEventListener('click', () => {
  openPage('reminders');
  document.getElementById('title').focus();
});

searchInput.addEventListener('input', () => {
  render();
});

alarmFileInput.addEventListener('click', (event) => {
  if (allowAlarmFilePickerClick) {
    allowAlarmFilePickerClick = false;
    return;
  }

  event.preventDefault();
  requestAlarmFileSelection();
});
alarmFileInput.addEventListener('change', handleAlarmFileChange);
recurrenceInput.addEventListener('change', updateRecurrenceOptions);
recurrenceEndModeInput.addEventListener('change', updateRecurrenceOptions);
previewAlarmBtn.addEventListener('click', async () => {
  if (!alarmEnabledInput.checked) {
    alarmStatus.textContent = 'Test etmek için önce sesli alarmı etkinleştirin.';
    return;
  }
  if (await playAlarm()) {
    checkDueReminders();
  }
});
clearAlarmBtn.addEventListener('click', clearCustomAlarm);
stopAlarmBtn.addEventListener('click', () => stopAlarm());
alarmVolumeInput.addEventListener('input', () => {
  if (activeAlarm) {
    activeAlarm.volume = Number(alarmVolumeInput.value);
  }
  alarmVolumeValue.textContent = `${Math.round(Number(alarmVolumeInput.value) * 100)}%`;
  saveAlarmSettings();
});
alarmEnabledInput.addEventListener('change', () => {
  saveAlarmSettings();
  if (alarmEnabledInput.checked) {
    alarmStatus.textContent = 'Sesli alarm etkinleştirildi.';
    checkDueReminders();
  } else {
    stopAlarm(false);
    alarmStatus.textContent = 'Sesli alarm kapatıldı.';
  }
});

clearCompletedBtn.addEventListener('click', () => {
  reminders = reminders.filter((reminder) => !reminder.completed);
  saveReminders();
  render();
});

cancelEditBtn.addEventListener('click', () => {
  reminderForm.reset();
  resetFormState();
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  document.getElementById('date').value = `${year}-${month}-${day}`;
});

reminderForm.addEventListener('submit', handleFormSubmit);
notifyBtn.addEventListener('click', requestNotificationPermission);
themeToggleBtn.addEventListener('click', () => {
  const nextTheme = document.body.classList.contains('dark-theme') ? 'light' : 'dark';
  applyTheme(nextTheme);
});

window.addEventListener('load', () => {
  initializeNotificationStages();
  registerOfflineSupport();
  updateNotificationStatus().catch((error) => {
    console.error('Bildirim durumu okunamadı:', error);
    notificationStatus.textContent = 'Bildirim durumu alınamadı. İzinleri kontrol edin.';
  });
  synchronizeNativeNotifications().catch((error) => {
    console.error('iOS bildirimleri başlatılamadı:', error);
    notificationStatus.textContent = 'iOS bildirimleri başlatılamadı. İzinleri kontrol edin.';
  });
  synchronizeNativeWidget().catch((error) => {
    console.error('iOS widget bilgileri başlatılamadı:', error);
    notificationStatus.textContent = 'Widget bilgileri eşitlenemedi. App Group yapılandırmasını kontrol edin.';
  });
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'light';
  applyTheme(savedTheme);
  loadAlarmSettings();
  updateAlarmControls();

  const today = new Date();
  todayLabel.textContent = new Intl.DateTimeFormat('tr-TR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(today);
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  document.getElementById('date').value = `${year}-${month}-${day}`;
  resetFormState();
  render();
  checkDueReminders();
  if (!isNativeIOSApp() && isIOSDevice() && !isAppInstalled()) {
    notificationStatus.textContent = 'iPhone’da bildirim için iOS/iPadOS 16.4 veya üzeri gerekir. HTTPS adresindeki uygulamayı Safari’den ana ekrana ekleyip oradan açın.';
  }
});

setInterval(checkDueReminders, 30000);
