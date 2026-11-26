const PROP_DEFAULTS = {
  REMINDERS_LIST: 'Everyday Reminders',
  ONE_TIME_LIST: '@default',
  REPEATED_LIST: 'Repeated Tasks',
  CALENDAR_IDS: '',
  UPCOMING_DAYS: '14',
};

const LIST_KEYS = {
  reminders: 'REMINDERS_LIST',
  oneTime: 'ONE_TIME_LIST',
  repeated: 'REPEATED_LIST',
};

const DEFAULT_CYCLE = { count: 1, unit: 'w' };
const MAX_UPCOMING_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;
const LAST_USED_STEP_MS = 60 * 60 * 1000;
const DEFAULT_DEVICE_IDLE_DAYS = 90;
const PAIRING_SECONDS = 600;
const PAIRING_MAX_FAILURES = 10;
const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

// Run this function one time in the Apps Script editor. It sets the allowed account, the task lists and the daily trigger.
function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ALLOWED_EMAIL')) {
    props.setProperty('ALLOWED_EMAIL', Session.getEffectiveUser().getEmail());
  }
  props.deleteProperty('TOKEN');
  Object.values(LIST_KEYS).forEach((key) => resolveListId(key, true));
  installDailyResetTrigger();
  console.log(`Allowed account: ${props.getProperty('ALLOWED_EMAIL')}`);
  if (!props.getProperty('CLIENT_ID')) {
    console.log('Next step: add the CLIENT_ID script property (the OAuth client ID from Google Cloud Console).');
  }
}

function installDailyResetTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'resetRemindersDaily')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('resetRemindersDaily')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .inTimezone(getTimeZone())
    .create();
}

function resetRemindersDaily() {
  resetReminders();
}

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const callback = params.callback;
  if (!params.payload) {
    return ContentService.createTextOutput('BuJo Dashboard API is running.');
  }
  let result;
  try {
    result = handle(JSON.parse(params.payload));
  } catch (err) {
    result = failure(err);
  }
  return respond(result, callback);
}

function doPost(e) {
  let result;
  try {
    const body = e && e.postData ? e.postData.contents : '{}';
    result = handle(JSON.parse(body));
  } catch (err) {
    result = failure(err);
  }
  return respond(result);
}

function respond(result, callback) {
  const json = JSON.stringify(result);
  if (callback && /^[A-Za-z_$][\w$]*$/.test(callback)) {
    return ContentService.createTextOutput(`${callback}(${json});`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function failure(err) {
  const result = { ok: false, error: String(err && err.message ? err.message : err) };
  if (err && err.code) {
    result.code = err.code;
  }
  return result;
}

// The page signs out when it gets an error with this code.
function authError(message) {
  const error = new Error(message);
  error.code = 'auth';
  return error;
}

function handle(request) {
  if (!request || typeof request !== 'object') {
    throw new Error('The request is empty.');
  }
  const publicActions = {
    config: () => ({ clientId: getProp('CLIENT_ID') || '' }),
    signIn: () => signIn(request.idToken, request.label),
    pair: () => pairDevice(request.code, request.label),
  };
  if (publicActions[request.action]) {
    return { ok: true, data: publicActions[request.action]() };
  }
  const device = authenticate(request.deviceToken);
  const actions = {
    ping: () => ({ timeZone: getTimeZone(), today: todayKey(), account: device.email }),
    dashboard: () => getDashboard(request.days),
    setTask: () => setTaskDone(request.list, request.id, Boolean(request.done)),
    addTask: () => addTask(request.list, request.title),
    resetReminders: () => resetReminders(),
    createPairingCode: () => createPairingCode(device),
    listDevices: () => listDevices(device),
    revokeDevice: () => revokeDevice(device, request.id),
    listCalendars: () => listCalendars(),
    setCalendars: () => setCalendars(device, request.ids),
    createEvent: () => createEvent(request),
    signOut: () => revokeDevice(device, device.id),
  };
  const action = actions[request.action];
  if (!action) {
    throw new Error(`Unknown action: ${request.action}`);
  }
  return { ok: true, data: action() };
}

function allowedEmail() {
  const email = String(getProp('ALLOWED_EMAIL') || '').trim().toLowerCase();
  if (!email) {
    throw new Error('Server is not set up. Run setup() in the Apps Script editor.');
  }
  return email;
}

// The tokeninfo endpoint of Google checks the signature and the expiry of the ID token.
function verifyIdToken(idToken) {
  const clientId = getProp('CLIENT_ID');
  if (!clientId) {
    throw new Error('Server is not set up. Add the CLIENT_ID script property.');
  }
  if (!idToken) {
    throw authError('The Google sign-in sent no token.');
  }
  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo', {
    method: 'post',
    payload: { id_token: String(idToken) },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) {
    throw authError('Google did not accept the sign-in. Try again.');
  }
  const info = JSON.parse(response.getContentText());
  const email = String(info.email || '').toLowerCase();
  const valid =
    info.aud === clientId &&
    GOOGLE_ISSUERS.includes(info.iss) &&
    String(info.email_verified) === 'true' &&
    Number(info.exp) * 1000 > Date.now() &&
    email === allowedEmail();
  if (!valid) {
    throw authError('This Google account does not have access to this dashboard.');
  }
  return email;
}

function signIn(idToken, label) {
  const email = verifyIdToken(idToken);
  return issueDevice('google', label, email);
}

function createPairingCode(device) {
  requireGoogleDevice(device);
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid());
  const code = bytes.slice(0, 8).map((byte) => PAIRING_ALPHABET.charAt(byte & 31)).join('');
  CacheService.getScriptCache().put(`pair:${sha256Hex(code)}`, '1', PAIRING_SECONDS);
  return { code, expiresInMinutes: PAIRING_SECONDS / 60 };
}

function pairDevice(rawCode, label) {
  const code = String(rawCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const cache = CacheService.getScriptCache();
  return withLock(() => {
    const failures = Number(cache.get('pair:failures')) || 0;
    if (failures >= PAIRING_MAX_FAILURES) {
      throw authError('Too many incorrect codes. Wait 10 minutes and make a new code.');
    }
    const key = `pair:${sha256Hex(code)}`;
    if (code.length !== 8 || !cache.get(key)) {
      cache.put('pair:failures', String(failures + 1), PAIRING_SECONDS);
      throw authError('The pairing code is not correct or it expired.');
    }
    cache.remove(key);
    return issueDevice('paired', label, allowedEmail(), true);
  });
}

function issueDevice(kind, label, email, locked) {
  const id = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  const secret = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  const now = Date.now();
  const save = () => {
    const devices = pruneExpired(readDevices(), now);
    devices[id] = {
      hash: sha256Hex(secret),
      kind,
      email,
      label: String(label || 'Browser').slice(0, 40),
      created: now,
      lastUsed: now,
    };
    writeDevices(devices);
  };
  if (locked) {
    save();
  } else {
    withLock(save);
  }
  return { deviceToken: `${id}.${secret}`, account: email, kind };
}

function authenticate(deviceToken) {
  const parts = String(deviceToken || '').split('.');
  const id = parts[0];
  const device = parts.length === 2 ? readDevices()[id] : null;
  if (!device || device.hash !== sha256Hex(parts[1]) || device.email !== allowedEmail()) {
    throw authError('This device is not signed in. Open Settings and sign in.');
  }
  const now = Date.now();
  if (now - device.lastUsed > deviceIdleDays() * DAY_MS) {
    withLock(() => writeDevices(pruneExpired(readDevices(), now)));
    throw authError('This device was not used for a long time. Open Settings and sign in again.');
  }
  if (now - device.lastUsed > LAST_USED_STEP_MS) {
    withLock(() => {
      const devices = readDevices();
      if (devices[id]) {
        devices[id].lastUsed = now;
        writeDevices(devices);
      }
    });
  }
  return { ...device, id };
}

function requireGoogleDevice(device) {
  if (device.kind !== 'google') {
    throw new Error('Sign in with Google to manage devices. A paired device cannot do this.');
  }
}

function listDevices(device) {
  requireGoogleDevice(device);
  const devices = readDevices();
  return Object.keys(devices)
    .map((id) => ({
      id,
      label: devices[id].label,
      kind: devices[id].kind,
      created: devices[id].created,
      lastUsed: devices[id].lastUsed,
      current: id === device.id,
    }))
    .sort((a, b) => b.lastUsed - a.lastUsed);
}

function revokeDevice(device, targetId) {
  if (targetId !== device.id) {
    requireGoogleDevice(device);
  }
  withLock(() => {
    const devices = readDevices();
    delete devices[targetId];
    writeDevices(devices);
  });
  return { revoked: targetId };
}

function deviceIdleDays() {
  return Number(getProp('DEVICE_IDLE_DAYS')) || DEFAULT_DEVICE_IDLE_DAYS;
}

function pruneExpired(devices, now) {
  const maxIdle = deviceIdleDays() * DAY_MS;
  Object.keys(devices).forEach((id) => {
    if (now - devices[id].lastUsed > maxIdle) {
      delete devices[id];
    }
  });
  return devices;
}

function readDevices() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty('DEVICES') || '{}');
  } catch {
    return {};
  }
}

function writeDevices(devices) {
  PropertiesService.getScriptProperties().setProperty('DEVICES', JSON.stringify(devices));
}

function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function sha256Hex(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8)
    .map((byte) => ((byte + 256) % 256).toString(16).padStart(2, '0'))
    .join('');
}

function getDashboard(requestedDays) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    resetRemindersIfNewDay();
    const days = clampDays(requestedDays);
    const tz = getTimeZone();
    const today = todayKey();
    const tomorrow = addToDateKey(today, 1, 'd');
    const rangeEnd = addToDateKey(today, days + 1, 'd');
    const weekStart = weekStartKey(today);
    return {
      timeZone: tz,
      today,
      generatedAt: Date.now(),
      upcomingDays: days,
      weekStart,
      earlierEvents: weekStart < today ? getEvents(dateKeyToDate(weekStart), dateKeyToDate(today)) : [],
      todayEvents: getEvents(dateKeyToDate(today), dateKeyToDate(tomorrow)),
      upcomingEvents: getEvents(dateKeyToDate(tomorrow), dateKeyToDate(rangeEnd)),
      calendars: getCalendars().map((calendar) => ({ id: calendar.getId(), name: calendar.getName(), writable: calendar.isOwnedByMe() })),
      reminders: listTasks('reminders').map(toClientTask),
      oneTime: listTasks('oneTime').filter((task) => isOpenOrDoneToday(task, today)).map(toClientTask),
      repeated: refreshRepeated(listTasks('repeated'), today).map(toRepeatedClientTask),
    };
  } finally {
    lock.releaseLock();
  }
}

function clampDays(value) {
  const fallback = Number(getProp('UPCOMING_DAYS')) || 7;
  const days = Math.round(Number(value) || fallback);
  return Math.min(MAX_UPCOMING_DAYS, Math.max(7, days));
}

function getEvents(start, end) {
  const tz = getTimeZone();
  const events = [];
  const seen = {};
  getCalendars().forEach((calendar) => {
    calendar.getEvents(start, end).forEach((event) => {
      const id = `${event.getId()}@${event.getStartTime().getTime()}`;
      // An event that is in two chosen calendars shows one time only.
      if (seen[id] || event.getMyStatus() === CalendarApp.GuestStatus.NO) {
        return;
      }
      seen[id] = true;
      const allDay = event.isAllDayEvent();
      events.push({
        id,
        title: event.getTitle() || '(no title)',
        location: event.getLocation() || '',
        calendar: calendar.getName(),
        allDay,
        start: event.getStartTime().getTime(),
        end: event.getEndTime().getTime(),
        startDate: allDay ? allDayKey(event.getAllDayStartDate()) : Utilities.formatDate(event.getStartTime(), tz, 'yyyy-MM-dd'),
        endDate: allDay ? allDayKey(event.getAllDayEndDate()) : Utilities.formatDate(event.getEndTime(), tz, 'yyyy-MM-dd'),
      });
    });
  });
  return events.sort((a, b) => (a.allDay === b.allDay ? a.start - b.start : a.allDay ? -1 : 1));
}

// Apps Script gives all-day dates as midnight in the script time zone, not in the calendar time zone.
// Formatting them in the calendar time zone can move them to the day before.
function allDayKey(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function selectedCalendarIds() {
  return getProp('CALENDAR_IDS').split(',').map((id) => id.trim()).filter(Boolean);
}

function getCalendars() {
  const ids = selectedCalendarIds();
  if (!ids.length) {
    return [CalendarApp.getDefaultCalendar()];
  }
  return ids.map((id) => CalendarApp.getCalendarById(id)).filter(Boolean);
}

// The default calendar is first, then the calendars in name order.
function listCalendars() {
  const defaultId = CalendarApp.getDefaultCalendar().getId();
  const ids = selectedCalendarIds();
  const selected = ids.length ? ids : [defaultId];
  return CalendarApp.getAllCalendars()
    .map((calendar) => ({
      id: calendar.getId(),
      name: calendar.getName(),
      color: calendar.getColor(),
      primary: calendar.getId() === defaultId,
      selected: selected.includes(calendar.getId()),
    }))
    .sort((a, b) => (a.primary === b.primary ? a.name.localeCompare(b.name) : a.primary ? -1 : 1));
}

function setCalendars(device, ids) {
  if (device.kind !== 'google') {
    throw new Error('Sign in with Google to choose calendars. A paired device cannot do this.');
  }
  const known = CalendarApp.getAllCalendars().map((calendar) => calendar.getId());
  const chosen = (Array.isArray(ids) ? ids : []).map(String).filter((id, index, all) => known.includes(id) && all.indexOf(id) === index);
  if (!chosen.length) {
    throw new Error('Choose at least one calendar.');
  }
  PropertiesService.getScriptProperties().setProperty('CALENDAR_IDS', chosen.join(','));
  return listCalendars();
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// New events can go only to a calendar that is shown on the dashboard and that this account owns.
function createEvent(request) {
  const title = String(request.title || '').trim().slice(0, 1024);
  if (!title) {
    throw new Error('The event title is empty.');
  }
  const date = String(request.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Write the date as YYYY-MM-DD.');
  }
  const calendar = getCalendars().find((item) => item.getId() === request.calendarId);
  if (!calendar || !calendar.isOwnedByMe()) {
    throw new Error('Choose one of your own calendars that the dashboard shows.');
  }
  if (request.allDay) {
    return { id: calendar.createAllDayEvent(title, dateKeyToDate(date)).getId() };
  }
  if (!TIME_PATTERN.test(request.start) || !TIME_PATTERN.test(request.end)) {
    throw new Error('Write the times as HH:MM.');
  }
  if (request.end <= request.start) {
    throw new Error('The end time must be after the start time.');
  }
  const tz = calendar.getTimeZone() || getTimeZone();
  const at = (time) => Utilities.parseDate(`${date} ${time}:00`, tz, 'yyyy-MM-dd HH:mm:ss');
  return { id: calendar.createEvent(title, at(request.start), at(request.end)).getId() };
}

function listTasks(listName) {
  const listId = resolveListId(LIST_KEYS[listName], false);
  const tasks = [];
  let pageToken;
  do {
    const page = Tasks.Tasks.list(listId, {
      showCompleted: true,
      showHidden: true,
      maxResults: 100,
      pageToken,
    });
    (page.items || []).forEach((task) => {
      if (task.title && !task.deleted) {
        tasks.push(task);
      }
    });
    pageToken = page.nextPageToken;
  } while (pageToken);
  return tasks.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
}

function toClientTask(task) {
  return {
    id: task.id,
    title: task.title,
    notes: task.notes || '',
    done: task.status === 'completed',
    due: task.due ? task.due.slice(0, 10) : '',
  };
}

function toRepeatedClientTask(task) {
  const cycle = parseCycle(task.notes);
  return { ...toClientTask(task), cycle: `${cycle.count}${cycle.unit}` };
}

function isOpenOrDoneToday(task, today) {
  if (task.status !== 'completed') {
    return true;
  }
  return Boolean(task.completed) && Utilities.formatDate(new Date(task.completed), getTimeZone(), 'yyyy-MM-dd') === today;
}

// A completed repeated task stays completed until its next due date. On that date, the task opens again.
// If the task was completed in another app, the next due date starts from the completion date.
function refreshRepeated(tasks, today) {
  return tasks.map((task) => {
    if (task.status !== 'completed') {
      return task;
    }
    const doneOn = completedDateKey(task) || today;
    const due = task.due ? task.due.slice(0, 10) : '';
    const nextDue = due > doneOn ? due : nextCycleDate(doneOn, parseCycle(task.notes));
    const listId = resolveListId(LIST_KEYS.repeated, false);
    if (nextDue > today) {
      return due === nextDue ? task : Tasks.Tasks.patch({ due: toTasksDue(nextDue) }, listId, task.id);
    }
    return Tasks.Tasks.patch({ status: 'needsAction', completed: null, due: toTasksDue(nextDue) }, listId, task.id);
  });
}

function completedDateKey(task) {
  return task.completed ? Utilities.formatDate(new Date(task.completed), getTimeZone(), 'yyyy-MM-dd') : '';
}

function parseCycle(notes) {
  const text = String(notes || '').toLowerCase();
  const match = text.match(/every\s*:?\s*(\d+)\s*([dwm])/);
  if (match) {
    return { count: Math.max(1, Number(match[1])), unit: match[2] };
  }
  if (/\bdaily\b/.test(text)) return { count: 1, unit: 'd' };
  if (/\bweekly\b/.test(text)) return { count: 1, unit: 'w' };
  if (/\bmonthly\b/.test(text)) return { count: 1, unit: 'm' };
  return DEFAULT_CYCLE;
}

function nextCycleDate(fromKey, cycle) {
  return addToDateKey(fromKey, cycle.count, cycle.unit);
}

function setTaskDone(listName, taskId, done) {
  const listId = resolveListId(requireListKey(listName), false);
  const patch = done ? { status: 'completed' } : { status: 'needsAction', completed: null };
  if (listName === 'repeated') {
    const task = Tasks.Tasks.get(listId, taskId);
    const today = todayKey();
    patch.due = toTasksDue(done ? nextCycleDate(today, parseCycle(task.notes)) : today);
  }
  const updated = Tasks.Tasks.patch(patch, listId, taskId);
  return listName === 'repeated' ? toRepeatedClientTask(updated) : toClientTask(updated);
}

function addTask(listName, title) {
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) {
    throw new Error('The task title is empty.');
  }
  const listId = resolveListId(requireListKey(listName), false);
  const created = Tasks.Tasks.insert({ title: cleanTitle.slice(0, 1024) }, listId);
  return listName === 'repeated' ? toRepeatedClientTask(created) : toClientTask(created);
}

function resetReminders() {
  const listId = resolveListId(LIST_KEYS.reminders, false);
  listTasks('reminders')
    .filter((task) => task.status === 'completed')
    .forEach((task) => Tasks.Tasks.patch({ status: 'needsAction', completed: null }, listId, task.id));
  PropertiesService.getScriptProperties().setProperty('LAST_REMINDER_RESET', todayKey());
  return { reset: true, today: todayKey() };
}

// The trigger can fail or start late. This check opens all reminders again on the first load of a new day.
function resetRemindersIfNewDay() {
  if (PropertiesService.getScriptProperties().getProperty('LAST_REMINDER_RESET') !== todayKey()) {
    resetReminders();
  }
}

function requireListKey(listName) {
  const key = LIST_KEYS[listName];
  if (!key) {
    throw new Error(`Unknown task list: ${listName}`);
  }
  return key;
}

function resolveListId(propKey, createIfMissing) {
  const nameOrId = getProp(propKey);
  if (nameOrId === '@default') {
    return '@default';
  }
  const cache = CacheService.getScriptCache();
  const cacheKey = `list:${nameOrId}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const lists = [];
  let pageToken;
  do {
    const page = Tasks.Tasklists.list({ maxResults: 100, pageToken });
    lists.push(...(page.items || []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  let list = lists.find((item) => item.id === nameOrId || item.title === nameOrId);
  if (!list) {
    if (!createIfMissing) {
      throw new Error(`Task list "${nameOrId}" was not found. Run setup() to make it.`);
    }
    list = Tasks.Tasklists.insert({ title: nameOrId });
  }
  cache.put(cacheKey, list.id, 21600);
  return list.id;
}

function getProp(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  return value === null || value === '' ? PROP_DEFAULTS[key] : value;
}

function getTimeZone() {
  return CalendarApp.getDefaultCalendar().getTimeZone() || Session.getScriptTimeZone();
}

function todayKey() {
  return Utilities.formatDate(new Date(), getTimeZone(), 'yyyy-MM-dd');
}

function dateKeyToDate(key) {
  return Utilities.parseDate(`${key} 00:00:00`, getTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function addToDateKey(key, count, unit) {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (unit === 'm') {
    date.setUTCMonth(date.getUTCMonth() + count);
  } else {
    date.setUTCDate(date.getUTCDate() + count * (unit === 'w' ? 7 : 1));
  }
  return date.toISOString().slice(0, 10);
}

// The week starts on Monday, as in ISO 8601.
function weekStartKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addToDateKey(key, -((weekday + 6) % 7), 'd');
}

function toTasksDue(key) {
  return `${key}T00:00:00.000Z`;
}
