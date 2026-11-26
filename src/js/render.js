import { h } from './dom.js';
import { formatPairingCode } from './auth.js';
import { dateKeyFromDate, formatDayName, formatMonthDay, formatShortDate, formatTime, relativeDayLabel } from './dates.js';
import {
  SIGNIFIERS,
  buildWeek,
  describeCycle,
  dueInfo,
  eventPhase,
  groupUpcoming,
  isMultiDay,
  lastDayOf,
  nowMarkerIndex,
  parseTitle,
  progressBar,
  sortTasks,
} from './bujo.js';

const empty = (text) => h('p', { className: 'empty' }, text);

const priorityMark = (priority) =>
  priority ? h('span', { className: 'sig sig-priority', title: 'Priority', text: SIGNIFIERS.priority }) : h('span', { className: 'sig sig-priority sig-blank' }, ' ');

const eventTime = (event, ctx) => {
  if (event.allDay) {
    return h('span', { className: 'badge' }, 'all day');
  }
  return `${formatTime(event.start, ctx.clock24h)}–${formatTime(event.end, ctx.clock24h)}`;
};

const eventRow = (event, ctx, phase, note = '') => {
  const { text, priority } = parseTitle(event.title);
  const extra = [note, event.location, isMultiDay(event) ? `until ${formatMonthDay(lastDayOf(event))}` : '']
    .filter(Boolean)
    .join(' · ');
  return h(
    'li',
    { className: `row event event-${phase}` },
    priorityMark(priority),
    h('span', { className: 'sig', 'aria-hidden': 'true' }, SIGNIFIERS.event),
    h('span', { className: 'time mono' }, eventTime(event, ctx)),
    h(
      'span',
      { className: 'text' },
      text,
      phase === 'now' ? h('span', { className: 'tag tag-now' }, 'now') : null,
      extra ? h('span', { className: 'meta' }, extra) : null,
    ),
  );
};

export const renderToday = (events, ctx) => {
  if (!events.length) {
    return empty('No events today. A clear page.');
  }
  const markerAt = nowMarkerIndex(events, ctx.now);
  const rows = [];
  events.forEach((event, index) => {
    if (index === markerAt) {
      rows.push(nowLine(ctx));
    }
    rows.push(eventRow(event, ctx, eventPhase(event, ctx.now)));
  });
  if (markerAt === events.length) {
    rows.push(nowLine(ctx));
  }
  return h('ul', { className: 'rows' }, rows);
};

const nowLine = (ctx) =>
  h('li', { className: 'now-line', 'aria-label': 'Current time' }, h('span', { className: 'mono' }, ctx.eink ? 'now' : `${formatTime(ctx.now, ctx.clock24h)} now`));

export const renderUpcoming = (events, ctx) => {
  const groups = groupUpcoming(events, ctx.today, ctx.days);
  if (!groups.length) {
    return empty(`Nothing planned for the next ${ctx.days} days.`);
  }
  return h(
    'div',
    { className: 'agenda' },
    groups.map((group) => {
      const relative = relativeDayLabel(ctx.today, group.key);
      return h(
        'div',
        { className: 'agenda-day' },
        h('h3', { className: 'agenda-date mono' }, formatShortDate(group.key), relative ? h('span', { className: 'meta' }, ` ${relative}`) : null),
        h('ul', { className: 'rows' }, group.events.map((event) => eventRow(event, ctx, 'next'))),
      );
    }),
  );
};

const taskRow = (list, task, ctx, extraMeta) => {
  const { text, priority } = parseTitle(task.title);
  const pending = Boolean(ctx.pending[task.id]);
  let signifier = list === 'repeated' ? SIGNIFIERS.repeat : SIGNIFIERS.task;
  if (task.done) {
    signifier = SIGNIFIERS.done;
  }
  return h(
    'li',
    { className: `row task${task.done ? ' is-done' : ''}${pending ? ' is-pending' : ''}` },
    h(
      'button',
      {
        type: 'button',
        className: 'task-toggle',
        'data-action': 'toggle-task',
        'data-list': list,
        'data-id': task.id,
        'aria-pressed': task.done ? 'true' : 'false',
        title: task.done ? 'Mark as not done' : 'Mark as done',
      },
      priorityMark(priority),
      h('span', { className: 'sig', 'aria-hidden': 'true' }, signifier),
      h('span', { className: 'text' }, text, extraMeta ? h('span', { className: `meta${extraMeta.overdue ? ' overdue' : ''}` }, extraMeta.text) : null),
    ),
  );
};

export const renderReminders = (tasks, ctx) => {
  if (!tasks.length) {
    return empty('Add tasks to the "Everyday Reminders" list in Google Tasks.');
  }
  const done = tasks.filter((task) => task.done).length;
  const complete = done === tasks.length;
  return h(
    'div',
    null,
    h(
      'p',
      { className: `progress mono${complete ? ' is-complete' : ''}` },
      progressBar(done, tasks.length),
      complete ? h('span', { className: 'tag tag-done' }, 'all done') : null,
    ),
    h('ul', { className: 'rows' }, tasks.map((task) => taskRow('reminders', task, ctx))),
  );
};

export const renderOneTime = (tasks, ctx) => {
  const rows = sortTasks(tasks).map((task) => taskRow('oneTime', task, ctx, task.done ? null : dueInfo(task.due, ctx.today)));
  return h(
    'div',
    null,
    rows.length ? h('ul', { className: 'rows' }, rows) : empty('No open tasks.'),
    h(
      'form',
      { className: 'quick-add', 'data-form': 'add-task', 'data-list': 'oneTime', autocomplete: 'off' },
      h('span', { className: 'sig', 'aria-hidden': 'true' }, SIGNIFIERS.task),
      h('input', { type: 'text', name: 'title', placeholder: 'New task (* = priority)', 'aria-label': 'New task', maxlength: '1024' }),
      h('button', { type: 'submit', className: 'btn btn-small' }, 'Add'),
    ),
  );
};

export const renderRepeated = (tasks, ctx) => {
  if (!tasks.length) {
    return empty('Add tasks to the "Repeated Tasks" list. Write "every: 2w" in the notes to set the cycle.');
  }
  const rows = sortTasks(tasks).map((task) => {
    const cycle = describeCycle(task.cycle);
    const meta = task.done && task.due ? `${cycle} · next ${formatMonthDay(task.due)}` : cycle;
    return taskRow('repeated', task, ctx, { text: meta, overdue: false });
  });
  return h('ul', { className: 'rows' }, rows);
};

const weekEventRows = (day, ctx) => {
  const events = day.events.map((item) => item.event);
  const rows = [];
  const markerAt = day.phase === 'today' ? nowMarkerIndex(events, ctx.now) : -1;
  day.events.forEach((item, index) => {
    if (index === markerAt) {
      rows.push(nowLine(ctx));
    }
    let phase = day.phase === 'past' ? 'past' : 'next';
    if (day.phase === 'today') {
      phase = eventPhase(item.event, ctx.now);
    }
    rows.push(eventRow(item.event, ctx, phase, item.continued ? 'cont.' : ''));
  });
  if (markerAt === events.length) {
    rows.push(nowLine(ctx));
  }
  return rows;
};

export const renderWeek = (data, ctx) =>
  h(
    'div',
    { className: 'week-log' },
    buildWeek(data, ctx.today).map((day) => {
      const rows = weekEventRows(day, ctx);
      return h(
        'div',
        { className: `log-day log-${day.phase}` },
        h('h3', { className: 'log-date mono' }, formatDayName(day.key), h('b', null, String(Number(day.key.slice(8))))),
        rows.length ? h('ul', { className: 'rows' }, rows) : h('p', { className: 'empty' }, '—'),
      );
    }),
  );

export const renderSetupHint = () =>
  h(
    'div',
    { className: 'setup-hint' },
    h('p', null, 'This dashboard is not connected yet.'),
    h('p', null, 'Open Settings, add your Apps Script Web App URL, and sign in with Google. On an e-reader, use a pairing code.'),
    h('button', { type: 'button', className: 'btn', 'data-action': 'open-settings' }, 'Open Settings'),
  );

const actionButton = (action, label, attrs = {}) => h('button', { type: 'button', className: 'btn btn-small', 'data-action': action, ...attrs }, label);

const renderDevices = (devices) =>
  h(
    'ul',
    { className: 'device-list' },
    devices.map((device) =>
      h(
        'li',
        { className: 'device' },
        h('span', { className: 'device-name' }, device.label),
        h('span', { className: 'meta mono' }, ` ${device.kind === 'google' ? 'Google' : 'paired'} · used ${dateKeyFromDate(new Date(device.lastUsed))} `),
        device.current ? h('span', { className: 'meta mono' }, '(this device)') : actionButton('revoke-device', 'Remove', { 'data-id': device.id }),
      ),
    ),
  );

const renderSignedIn = ({ settings, pairingCode, devices }) => {
  const isGoogle = settings.deviceKind === 'google';
  return [
    h('p', null, 'Signed in as ', h('strong', null, settings.account || 'unknown'), isGoogle ? '' : ' (paired device)'),
    h(
      'p',
      null,
      isGoogle ? actionButton('add-device', 'Add a device') : null,
      isGoogle ? actionButton('show-devices', 'Devices') : null,
      actionButton('sign-out', 'Sign out'),
    ),
    pairingCode
      ? h(
          'div',
          { className: 'pair-box' },
          h('p', { className: 'pair-code mono' }, formatPairingCode(pairingCode.code)),
          h('p', { className: 'hint' }, `On the other device, open Settings, add the Web App URL and type this code. It works one time, for ${pairingCode.expiresInMinutes} minutes.`),
        )
      : null,
    devices ? renderDevices(devices) : null,
  ];
};

const renderSignedOut = () => [
  h('div', { id: 'google-btn', className: 'google-btn' }, h('p', { className: 'hint' }, 'Loading Google sign-in…')),
  h('p', { className: 'hint' }, 'E-reader, or Google sign-in does not work here? On a signed-in device, open Settings and click "Add a device". Then type the code here.'),
  h(
    'div',
    { className: 'field' },
    h('span', { className: 'field-label mono' }, 'Pairing code'),
    h('input', { type: 'text', name: 'pairingCode', className: 'pair-input mono', maxlength: '9', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'ABCD-EFGH' }),
    ' ',
    actionButton('pair', 'Pair'),
  ),
];

const calendarOption = (calendar, editable) =>
  h(
    'label',
    { className: 'field-check calendar-option' },
    h('input', { type: 'checkbox', name: 'calendar', value: calendar.id, checked: calendar.selected, disabled: !editable }),
    h('span', { className: 'swatch', style: `background-color: ${calendar.color}` }),
    h('span', null, calendar.name),
    calendar.primary ? h('span', { className: 'meta mono' }, 'default') : null,
  );

export const renderCalendars = (state) =>
  h(
    'div',
    null,
    h('span', { className: 'field-label mono' }, 'Calendars'),
    state.items ? state.items.map((calendar) => calendarOption(calendar, state.editable)) : null,
    state.items && !state.editable ? h('p', { className: 'hint' }, 'Sign in with Google on this device to change the calendars.') : null,
    state.message ? h('p', { className: 'hint mono', role: 'status' }, state.message) : null,
  );

export const renderAccess = (state) =>
  h(
    'div',
    null,
    h('span', { className: 'field-label mono' }, 'Access'),
    !state.hasUrl ? h('p', { className: 'hint' }, 'Add the Web App URL above. Then you can sign in here.') : null,
    state.hasUrl && state.signedIn ? renderSignedIn(state) : null,
    state.hasUrl && !state.signedIn ? renderSignedOut() : null,
    state.message ? h('p', { className: 'hint mono', role: 'status' }, state.message) : null,
  );
