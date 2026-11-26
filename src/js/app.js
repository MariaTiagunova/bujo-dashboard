import { Api } from './api.js';
import { deviceLabel, normalizePairingCode } from './auth.js';
import { byId, findActionTarget, h, isShown, replaceContent, setShown, toggleClass } from './dom.js';
import { addDays, dateKeyFromDate, formatLongDate, formatMonthDay, formatTime, isoWeek } from './dates.js';
import { eventProblem, todayPhaseSignature, weekStartKey } from './bujo.js';
import { renderGoogleButton } from './google.js';
import { hasApiUrl, isConfigured, loadSettings, saveSettings, signedOut } from './settings.js';
import { readJson, removeKey, writeJson } from './storage.js';
import { renderAccess, renderCalendars, renderOneTime, renderReminders, renderRepeated, renderSetupHint, renderToday, renderUpcoming, renderWeek } from './render.js';

const CACHE_KEY = 'bujo.cache.v1';
const TICK_MS = 60000;
const LIST_FIELDS = { reminders: 'reminders', oneTime: 'oneTime', repeated: 'repeated' };
const BLOCK_NUMBERS = {
  classic: { 'reminders-title': '01', 'today-title': '02', 'upcoming-title': '03', 'todo-title': '04' },
  week: { 'week-title': '01', 'reminders-title': '02', 'todo-title': '03' },
};
const emptyAccess = () => ({ pairingCode: null, devices: null, message: '' });

export class Dashboard {
  #settings = loadSettings();
  #api = new Api(() => this.#settings);
  #data = readJson(CACHE_KEY, null);
  #pending = {};
  #signatures = {};
  #syncing = false;
  #lastAttempt = 0;
  #lastSuccess = this.#data ? this.#data.receivedAt || 0 : 0;
  #error = '';
  #localDay = dateKeyFromDate(new Date());
  #access = emptyAccess();
  #calendars = { items: null, message: '' };
  #clientIds = {};

  start() {
    setShown(byId('boot'), false);
    this.#applyUrlOverrides();
    this.#applyTheme();
    this.#applyLayout();
    this.#bindEvents();
    this.#renderHeader();
    this.#renderBlocks();
    this.#renderStatus();
    setInterval(() => this.#tick(), TICK_MS);
    this.sync();
  }

  async sync() {
    if (this.#syncing) {
      return;
    }
    if (!isConfigured(this.#settings)) {
      this.#error = '';
      this.#renderBlocks();
      this.#renderStatus();
      return;
    }
    this.#syncing = true;
    this.#lastAttempt = Date.now();
    this.#renderStatus();
    try {
      const data = await this.#api.dashboard(this.#settings.upcomingDays);
      this.#data = { ...data, receivedAt: Date.now() };
      this.#lastSuccess = this.#data.receivedAt;
      this.#error = '';
      this.#saveCache();
    } catch (error) {
      this.#error = this.#failureMessage(error, '');
    } finally {
      this.#syncing = false;
      this.#renderBlocks();
      this.#renderStatus();
    }
  }

  #tick() {
    const now = new Date();
    const dayKey = dateKeyFromDate(now);
    const dayChanged = dayKey !== this.#localDay;
    this.#localDay = dayKey;
    this.#renderHeader();
    const refreshMs = this.#settings.refreshMinutes * 60000;
    const due = refreshMs > 0 && now.getTime() - this.#lastAttempt >= refreshMs;
    if (dayChanged || due) {
      this.sync();
    } else {
      this.#renderBlocks();
    }
  }

  #applyUrlOverrides() {
    const search = window.location.search;
    const eink = /[?&]eink=(1|0|on|off|true|false)/.exec(search);
    if (eink) {
      this.#settings = saveSettings({ ...this.#settings, eink: ['1', 'on', 'true'].includes(eink[1]) });
    }
    const layout = /[?&]layout=(classic|week)/.exec(search);
    if (layout) {
      this.#settings = saveSettings({ ...this.#settings, layout: layout[1] });
    }
  }

  #applyTheme() {
    toggleClass(document.documentElement, 'eink', this.#settings.eink);
    const toggle = byId('eink-toggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', this.#settings.eink ? 'true' : 'false');
    }
    this.#signatures = {};
  }

  // Old e-reader browsers do not support the flexbox order property, so the Everyday block moves in the DOM.
  #applyLayout() {
    const week = this.#settings.layout === 'week';
    toggleClass(document.documentElement, 'layout-week', week);
    byId('layout-toggle').setAttribute('aria-pressed', week ? 'true' : 'false');
    setShown(byId('week-block'), week);
    setShown(byId('today-block'), !week);
    setShown(byId('upcoming-block'), !week);
    const reminders = byId('reminders-block');
    if (week) {
      byId('col-right').insertBefore(reminders, byId('todo-block'));
    } else {
      byId('col-left').insertBefore(reminders, byId('today-block'));
    }
    const numbers = BLOCK_NUMBERS[this.#settings.layout];
    Object.keys(numbers).forEach((id) => {
      replaceContent(byId(id).firstChild, numbers[id]);
    });
    this.#signatures = {};
  }

  #bindEvents() {
    document.addEventListener('click', (event) => {
      const target = findActionTarget(event.target, document);
      if (!target) {
        return;
      }
      event.preventDefault();
      this.#runAction(target.getAttribute('data-action'), target);
    });
    document.addEventListener('submit', (event) => {
      const form = event.target;
      const active = document.activeElement;
      event.preventDefault();
      if (form.id === 'event-form') {
        this.#createEvent();
      } else if (form.getAttribute('data-form') === 'add-task') {
        this.#addTask(form);
      } else if (form.id === 'settings-form' && active && active.name === 'pairingCode') {
        this.#pair();
      } else if (form.id === 'settings-form') {
        this.#saveSettingsForm();
      }
    });
    document.addEventListener('change', (event) => {
      if (event.target && event.target.name === 'apiUrl') {
        this.#access = emptyAccess();
        this.#renderAccess();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' || event.keyCode === 27) {
        if (isShown(byId('settings'))) {
          this.#closeSettings();
        }
        setShown(byId('event-modal'), false);
      }
    });
    document.addEventListener('change', (event) => {
      if (event.target.name === 'allDay') {
        setShown(byId('event-times'), !event.target.checked);
      }
    });
    document.addEventListener('visibilitychange', () => {
      const staleMs = Math.max(1, this.#settings.refreshMinutes) * 60000;
      if (!document.hidden && Date.now() - this.#lastAttempt >= staleMs) {
        this.sync();
      }
    });
  }

  #runAction(action, target) {
    const actions = {
      refresh: () => this.sync(),
      'toggle-layout': () => {
        this.#settings = saveSettings({ ...this.#settings, layout: this.#settings.layout === 'week' ? 'classic' : 'week' });
        this.#applyLayout();
        this.#renderBlocks();
      },
      'toggle-eink': () => {
        this.#settings = saveSettings({ ...this.#settings, eink: !this.#settings.eink });
        this.#applyTheme();
        this.#renderBlocks();
      },
      'open-settings': () => this.#openSettings(),
      'close-settings': () => this.#closeSettings(),
      'open-event': () => this.#openEvent(),
      'close-event': () => setShown(byId('event-modal'), false),
      'test-settings': () => this.#testSettings(),
      'toggle-task': () => this.#toggleTask(target.getAttribute('data-list'), target.getAttribute('data-id')),
      'reset-reminders': () => this.#resetReminders(),
      pair: () => this.#pair(),
      'sign-out': () => this.#signOut(),
      'add-device': () => this.#runAccess('Making a code…', (api) => api.createPairingCode(), (pairingCode) => ({ pairingCode })),
      'show-devices': () => this.#showDevices(),
      'revoke-device': () => this.#revokeDevice(target.getAttribute('data-id')),
    };
    if (actions[action]) {
      actions[action]();
    }
  }

  async #toggleTask(list, id) {
    const task = this.#findTask(list, id);
    if (!task || this.#pending[id]) {
      return;
    }
    const done = !task.done;
    task.done = done;
    this.#pending[id] = true;
    this.#renderBlocks();
    try {
      const updated = await this.#api.setTask(list, id, done);
      Object.assign(task, updated);
      this.#error = '';
      this.#saveCache();
    } catch (error) {
      task.done = !done;
      this.#error = this.#failureMessage(error, 'Could not update the task.');
    } finally {
      delete this.#pending[id];
      this.#renderBlocks();
      this.#renderStatus();
    }
  }

  async #addTask(form) {
    const list = form.getAttribute('data-list');
    const input = form.elements.title;
    const title = input.value.trim();
    if (!title || !this.#data) {
      return;
    }
    const tempId = `tmp-${Date.now()}`;
    const tasks = this.#data[LIST_FIELDS[list]];
    tasks.push({ id: tempId, title, notes: '', done: false, due: '' });
    this.#pending[tempId] = true;
    input.value = '';
    this.#renderBlocks();
    try {
      const created = await this.#api.addTask(list, title);
      tasks.splice(tasks.findIndex((task) => task.id === tempId), 1, created);
      this.#error = '';
      this.#saveCache();
    } catch (error) {
      tasks.splice(tasks.findIndex((task) => task.id === tempId), 1);
      this.#error = this.#failureMessage(error, 'Could not add the task.');
      const freshInput = document.querySelector(`form[data-list="${list}"] input[name="title"]`);
      if (freshInput && !freshInput.value) {
        freshInput.value = title;
      }
    } finally {
      delete this.#pending[tempId];
      this.#renderBlocks();
      this.#renderStatus();
      const nextInput = document.querySelector(`form[data-list="${list}"] input[name="title"]`);
      if (nextInput && !this.#settings.eink) {
        nextInput.focus();
      }
    }
  }

  async #resetReminders() {
    if (!this.#data) {
      return;
    }
    const before = this.#data.reminders.map((task) => ({ ...task }));
    this.#data.reminders.forEach((task) => {
      task.done = false;
    });
    this.#renderBlocks();
    try {
      await this.#api.resetReminders();
      this.#error = '';
      this.#saveCache();
    } catch (error) {
      this.#data.reminders = before;
      this.#error = this.#failureMessage(error, 'Could not reset the reminders.');
    } finally {
      this.#renderBlocks();
      this.#renderStatus();
    }
  }

  // When the server does not accept the device token, this device forgets the token and the cached data.
  #failureMessage(error, prefix) {
    const message = error.message || 'Sync failed.';
    if (error.code !== 'auth') {
      return prefix ? `${prefix} ${message}` : message;
    }
    this.#forgetDevice();
    return message;
  }

  #forgetDevice() {
    this.#settings = saveSettings(signedOut(this.#settings));
    this.#data = null;
    this.#pending = {};
    this.#signatures = {};
    this.#access = emptyAccess();
    removeKey(CACHE_KEY);
  }

  #findTask(list, id) {
    const field = LIST_FIELDS[list];
    const tasks = this.#data && field ? this.#data[field] : [];
    return tasks.find((task) => task.id === id);
  }

  #saveCache() {
    writeJson(CACHE_KEY, this.#data);
  }

  #renderHeader() {
    const now = new Date();
    replaceContent(byId('date-title'), formatLongDate(now));
    replaceContent(byId('date-meta'), `${dateKeyFromDate(now)} · W${isoWeek(now)} · ${formatTime(now.getTime(), this.#settings.clock24h)}`);
  }

  #renderStatus() {
    const status = byId('sync-status');
    const time = this.#lastSuccess ? formatTime(this.#lastSuccess, this.#settings.clock24h) : '';
    let text = 'not synced';
    let state = 'idle';
    if (!hasApiUrl(this.#settings)) {
      text = 'not connected';
    } else if (!isConfigured(this.#settings)) {
      text = 'signed out';
    } else if (this.#syncing) {
      text = 'syncing…';
      state = 'busy';
    } else if (this.#error) {
      text = time ? `sync error · last ${time}` : 'sync error';
      state = 'error';
    } else if (time) {
      text = `synced ${time}`;
      state = 'ok';
    }
    status.className = `sync mono sync-${state}`;
    replaceContent(status, text);

    const notice = byId('notice');
    setShown(notice, Boolean(this.#error));
    replaceContent(notice, this.#error);

    const refresh = byId('refresh-btn');
    refresh.disabled = this.#syncing;
  }

  #renderBlocks() {
    const configured = isConfigured(this.#settings);
    const data = this.#data;
    if (!configured || !data) {
      const hint = configured ? 'loading' : 'setup';
      this.#paint('reminders-body', hint, () => (configured ? loadingText() : renderSetupHint()));
      this.#visibleBodies(['today-body', 'upcoming-body', 'week-body', 'onetime-body', 'repeated-body']).forEach((id) => this.#paint(id, hint, () => (configured ? loadingText() : emptyDash())));
      return;
    }
    const now = Date.now();
    const ctx = {
      now,
      today: data.today,
      days: data.upcomingDays || this.#settings.upcomingDays,
      clock24h: this.#settings.clock24h,
      eink: this.#settings.eink,
      pending: this.#pending,
    };
    const pendingKey = Object.keys(this.#pending).join(',');
    const minute = this.#settings.eink ? '' : formatTime(now, true);
    this.#paint('reminders-body', [data.reminders, pendingKey], () => renderReminders(data.reminders, ctx));
    const todayParts = [data.todayEvents, todayPhaseSignature(data.todayEvents, now), minute, ctx.clock24h];
    if (this.#settings.layout === 'week') {
      const start = weekStartKey(data.today);
      this.#paint('week-range', [start], () => `${formatMonthDay(start)} – ${formatMonthDay(addDays(start, 6))}`);
      const weekParts = [...todayParts, data.today, data.earlierEvents, data.upcomingEvents];
      this.#paint('week-body', weekParts, () => renderWeek(data, ctx));
    } else {
      this.#paint('today-body', todayParts, () => renderToday(data.todayEvents, ctx));
      this.#paint('upcoming-body', [data.upcomingEvents, data.today, ctx.clock24h], () => renderUpcoming(data.upcomingEvents, ctx));
    }
    this.#paint('onetime-body', [data.oneTime, pendingKey, data.today], () => renderOneTime(data.oneTime, ctx));
    this.#paint('repeated-body', [data.repeated, pendingKey], () => renderRepeated(data.repeated, ctx));
  }

  #visibleBodies(ids) {
    const hidden = this.#settings.layout === 'week' ? ['today-body', 'upcoming-body'] : ['week-body'];
    return ids.filter((id) => !hidden.includes(id));
  }

  // A block is drawn again only when its data changes. Each redraw makes an e-ink screen flash.
  #paint(id, signatureParts, build) {
    const signature = JSON.stringify(signatureParts);
    if (this.#signatures[id] === signature) {
      return;
    }
    const el = byId(id);
    const active = document.activeElement;
    if (id === 'onetime-body' && active && active.name === 'title' && el.contains(active) && active.value) {
      return;
    }
    this.#signatures[id] = signature;
    replaceContent(el, build());
  }

  #openSettings() {
    const form = byId('settings-form');
    const s = this.#settings;
    form.elements.apiUrl.value = s.apiUrl;
    form.elements.upcomingDays.value = String(s.upcomingDays);
    form.elements.refreshMinutes.value = String(s.refreshMinutes);
    form.elements.clock24h.checked = s.clock24h;
    replaceContent(byId('settings-status'), '');
    this.#access = emptyAccess();
    setShown(byId('settings'), true);
    this.#renderAccess();
    this.#loadCalendars();
    if (!s.eink) {
      form.elements.apiUrl.focus();
    }
  }

  #openEvent() {
    const form = byId('event-form');
    const calendars = this.#data && this.#data.calendars ? this.#data.calendars.filter((calendar) => calendar.writable) : [];
    const select = form.elements.calendarId;
    const chosen = calendars.some((calendar) => calendar.id === this.#settings.eventCalendarId) ? this.#settings.eventCalendarId : '';
    replaceContent(
      select,
      calendars.map((calendar) => h('option', { value: calendar.id, selected: calendar.id === chosen }, calendar.name)),
    );
    const now = new Date();
    const startHour = Math.min(now.getHours() + 1, 22);
    form.elements.title.value = '';
    form.elements.date.value = this.#data ? this.#data.today : dateKeyFromDate(now);
    form.elements.allDay.checked = false;
    form.elements.start.value = `${twoDigits(startHour)}:00`;
    form.elements.end.value = `${twoDigits(startHour + 1)}:00`;
    setShown(byId('event-times'), true);
    let hint = '';
    if (!isConfigured(this.#settings)) {
      hint = 'Open Settings and sign in first.';
    } else if (!calendars.length) {
      hint = 'Refresh first, or choose one of your own calendars in Settings.';
    }
    replaceContent(byId('event-status'), hint);
    setShown(byId('event-modal'), true);
    if (!this.#settings.eink) {
      form.elements.title.focus();
    }
  }

  async #createEvent() {
    const form = byId('event-form');
    const status = byId('event-status');
    const event = {
      title: form.elements.title.value.trim(),
      calendarId: form.elements.calendarId.value,
      date: form.elements.date.value.trim(),
      allDay: form.elements.allDay.checked,
      start: form.elements.start.value.trim(),
      end: form.elements.end.value.trim(),
    };
    const problem = eventProblem(event);
    if (problem) {
      replaceContent(status, problem);
      return;
    }
    replaceContent(status, 'Creating…');
    try {
      await this.#api.createEvent(event);
      this.#settings = saveSettings({ ...this.#settings, eventCalendarId: event.calendarId });
      setShown(byId('event-modal'), false);
      this.sync();
    } catch (error) {
      replaceContent(status, `Could not create the event. ${error.message}`);
    }
  }

  #closeSettings() {
    setShown(byId('settings'), false);
  }

  #readSettingsForm() {
    const form = byId('settings-form');
    return {
      ...this.#settings,
      apiUrl: form.elements.apiUrl.value,
      upcomingDays: form.elements.upcomingDays.value,
      refreshMinutes: form.elements.refreshMinutes.value,
      clock24h: form.elements.clock24h.checked,
    };
  }

  async #saveSettingsForm() {
    const calendarIds = this.#changedCalendarIds();
    if (calendarIds && !calendarIds.length) {
      this.#calendars.message = 'Choose at least one calendar.';
      this.#renderCalendars();
      return;
    }
    const before = this.#settings;
    this.#settings = saveSettings(this.#readSettingsForm());
    this.#closeSettings();
    this.#signatures = {};
    this.#renderHeader();
    const connectionChanged = before.apiUrl !== this.#settings.apiUrl;
    if (connectionChanged) {
      this.#forgetDevice();
      this.#error = '';
    }
    if (calendarIds && !connectionChanged) {
      try {
        await this.#api.setCalendars(calendarIds);
      } catch (error) {
        this.#error = `Could not save the calendars. ${error.message}`;
      }
      this.sync();
    } else if (connectionChanged || before.upcomingDays !== this.#settings.upcomingDays) {
      this.sync();
    } else {
      this.#renderBlocks();
      this.#renderStatus();
    }
  }

  async #testSettings() {
    const url = this.#formApiUrl();
    const status = byId('settings-status');
    replaceContent(status, 'Testing…');
    try {
      if (this.#isSignedInFor(url)) {
        const result = await new Api(() => this.#settings).ping();
        replaceContent(status, `Connected as ${result.account}. Calendar time zone: ${result.timeZone}.`);
      } else {
        await this.#publicApi(url).config();
        replaceContent(status, 'The Web App answers. Now sign in.');
      }
    } catch (error) {
      replaceContent(status, `Failed: ${error.message}`);
    }
  }

  // The result is null when the calendar choice did not change or cannot change on this device.
  #changedCalendarIds() {
    const items = this.#calendars.items;
    if (!items || this.#settings.deviceKind !== 'google') {
      return null;
    }
    const boxes = byId('calendars').getElementsByTagName('input');
    const ids = [];
    for (let i = 0; i < boxes.length; i += 1) {
      if (boxes[i].checked) {
        ids.push(boxes[i].value);
      }
    }
    const before = items.filter((calendar) => calendar.selected).map((calendar) => calendar.id);
    return ids.join(',') === before.join(',') ? null : ids;
  }

  async #loadCalendars() {
    if (!isConfigured(this.#settings)) {
      this.#calendars = { items: null, message: 'Sign in to choose calendars.' };
      this.#renderCalendars();
      return;
    }
    this.#calendars = { items: null, message: 'Loading calendars…' };
    this.#renderCalendars();
    try {
      this.#calendars = { items: await this.#api.listCalendars(), message: '' };
    } catch (error) {
      this.#calendars = { items: null, message: `Could not load the calendars. ${error.message}` };
    }
    this.#renderCalendars();
  }

  #renderCalendars() {
    const container = byId('calendars');
    if (container && isShown(byId('settings'))) {
      replaceContent(container, renderCalendars({ ...this.#calendars, editable: this.#settings.deviceKind === 'google' }));
    }
  }

  #formApiUrl() {
    return byId('settings-form').elements.apiUrl.value.trim();
  }

  #isSignedInFor(url) {
    return isConfigured(this.#settings) && this.#settings.apiUrl === url;
  }

  #publicApi(url) {
    return new Api(() => ({ apiUrl: url, deviceToken: '' }));
  }

  #renderAccess() {
    const container = byId('access');
    if (!container || !isShown(byId('settings'))) {
      return;
    }
    const url = this.#formApiUrl();
    const hasUrl = /^https:\/\//.test(url);
    const signedIn = this.#isSignedInFor(url);
    replaceContent(container, renderAccess({ ...this.#access, hasUrl, signedIn, settings: this.#settings }));
    if (hasUrl && !signedIn) {
      this.#showGoogleButton(url);
    }
  }

  #setAccessMessage(message) {
    this.#access.message = message;
    this.#renderAccess();
  }

  async #showGoogleButton(url) {
    const container = byId('google-btn');
    try {
      if (!this.#clientIds[url]) {
        const { clientId } = await this.#publicApi(url).config();
        if (!clientId) {
          throw new Error('The Web App has no CLIENT_ID script property. See the README.');
        }
        this.#clientIds[url] = clientId;
      }
      if (byId('google-btn') === container) {
        replaceContent(container);
        await renderGoogleButton(container, this.#clientIds[url], (credential) => this.#signIn(url, credential));
      }
    } catch (error) {
      if (byId('google-btn') === container) {
        replaceContent(container, h('p', { className: 'hint' }, error.message));
      }
    }
  }

  async #signIn(url, credential) {
    this.#setAccessMessage('Signing in…');
    try {
      this.#completeSignIn(url, await this.#publicApi(url).signIn(credential, deviceLabel(navigator.userAgent)));
    } catch (error) {
      this.#setAccessMessage(`Sign-in failed: ${error.message}`);
    }
  }

  async #pair() {
    const url = this.#formApiUrl();
    const input = byId('settings-form').elements.pairingCode;
    const code = normalizePairingCode(input ? input.value : '');
    if (code.length !== 8) {
      this.#setAccessMessage('Type the 8-character code.');
      return;
    }
    this.#setAccessMessage('Pairing…');
    try {
      const api = this.#publicApi(url);
      await api.config();
      this.#completeSignIn(url, await api.pair(code, deviceLabel(navigator.userAgent)));
    } catch (error) {
      this.#setAccessMessage(`Pairing failed: ${error.message}`);
    }
  }

  #completeSignIn(url, result) {
    this.#forgetDevice();
    this.#settings = saveSettings({
      ...this.#settings,
      apiUrl: url,
      deviceToken: result.deviceToken,
      account: result.account,
      deviceKind: result.kind,
    });
    this.#error = '';
    this.#access.message = 'Signed in.';
    this.#renderAccess();
    this.#loadCalendars();
    this.sync();
  }

  async #signOut() {
    this.#setAccessMessage('Signing out…');
    try {
      await this.#api.signOut();
    } catch {
      // The device forgets its token also when the server cannot be reached.
    }
    this.#forgetDevice();
    this.#error = '';
    this.#access.message = 'Signed out.';
    this.#renderAccess();
    this.#loadCalendars();
    this.#renderBlocks();
    this.#renderStatus();
  }

  async #showDevices() {
    await this.#runAccess('Loading devices…', (api) => api.listDevices(), (devices) => ({ devices }));
  }

  async #revokeDevice(id) {
    await this.#runAccess('Removing…', (api) => api.revokeDevice(id), () => ({}));
    await this.#showDevices();
  }

  async #runAccess(busyMessage, request, toState) {
    this.#setAccessMessage(busyMessage);
    try {
      const result = await request(this.#api);
      this.#access = { ...this.#access, ...toState(result), message: '' };
    } catch (error) {
      const message = this.#failureMessage(error, 'Failed:');
      this.#access.message = message;
      this.#renderBlocks();
      this.#renderStatus();
    }
    this.#renderAccess();
  }
}

const twoDigits = (value) => (value < 10 ? `0${value}` : String(value));

const loadingText = () => h('p', { className: 'empty' }, 'Loading…');

const emptyDash = () => h('p', { className: 'empty' }, '—');
