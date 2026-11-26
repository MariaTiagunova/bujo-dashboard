import { addDays, dateFromKey, daysBetween, formatMonthDay } from './dates.js';

export const SIGNIFIERS = {
  event: '○',
  task: '•',
  done: '×',
  repeat: '>',
  priority: '*',
};

const PRIORITY_PATTERN = /^\s*[*!]\s*/;

export const parseTitle = (title = '') => {
  const priority = PRIORITY_PATTERN.test(title);
  return { text: priority ? title.replace(PRIORITY_PATTERN, '') : title.trim(), priority };
};

export const progressBar = (done, total, maxCells = 10) => {
  if (!total) {
    return '[] 0/0';
  }
  const cells = Math.min(total, maxCells);
  const filled = done >= total ? cells : Math.floor((done / total) * cells);
  return `[${'■'.repeat(filled)}${'□'.repeat(cells - filled)}] ${done}/${total}`;
};

export const eventPhase = (event, now) => {
  if (event.allDay) {
    return 'allday';
  }
  if (event.end <= now) {
    return 'past';
  }
  return event.start <= now ? 'now' : 'next';
};

// The "now" marker goes in front of the first timed event that is not finished.
export const nowMarkerIndex = (events, now) => {
  const timed = events.filter((event) => !event.allDay);
  if (!timed.length) {
    return -1;
  }
  const index = events.findIndex((event) => !event.allDay && event.end > now);
  return index === -1 ? events.length : index;
};

export const todayPhaseSignature = (events, now) => events.map((event) => eventPhase(event, now)).join('');

export const groupUpcoming = (events, todayKey, days) => {
  const firstKey = addDays(todayKey, 1);
  const lastKey = addDays(todayKey, days);
  const groups = {};
  events.forEach((event) => {
    const key = event.startDate < firstKey ? firstKey : event.startDate;
    if (key > lastKey) {
      return;
    }
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(event);
  });
  return Object.keys(groups)
    .sort()
    .map((key) => ({ key, events: groups[key] }));
};

export const lastDayOf = (event) => (event.allDay ? addDays(event.endDate, -1) : event.endDate);

export const isMultiDay = (event) => lastDayOf(event) > event.startDate;

const UNIT_NAMES = { d: ['day', 'days'], w: ['week', 'weeks'], m: ['month', 'months'] };

export const describeCycle = (cycle = '1w') => {
  const match = /^(\d+)([dwm])$/.exec(cycle);
  if (!match) {
    return 'repeats';
  }
  const count = Number(match[1]);
  const [one, many] = UNIT_NAMES[match[2]];
  return count === 1 ? `every ${one}` : `every ${count} ${many}`;
};

export const dueInfo = (due, todayKey) => {
  if (!due) {
    return null;
  }
  const diff = daysBetween(todayKey, due);
  if (diff < 0) return { text: `overdue · ${formatMonthDay(due)}`, overdue: true };
  if (diff === 0) return { text: 'due today', overdue: false };
  if (diff === 1) return { text: 'due tomorrow', overdue: false };
  return { text: `due ${formatMonthDay(due)}`, overdue: false };
};

export const sortTasks = (tasks) => {
  const rank = (task) => (task.done ? 2 : parseTitle(task.title).priority ? 0 : 1);
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => rank(a.task) - rank(b.task) || a.index - b.index)
    .map((item) => item.task);
};

export const weekStartKey = (todayKey) => addDays(todayKey, -((dateFromKey(todayKey).getDay() + 6) % 7));

const coversDay = (event, key) => event.startDate <= key && (lastDayOf(event) >= key || event.startDate === key);

const byStart = (a, b) => (a.allDay === b.allDay ? a.start - b.start : a.allDay ? -1 : 1);

const uniqueEvents = (lists) => {
  const seen = {};
  const result = [];
  lists.forEach((list) => {
    (list || []).forEach((event) => {
      if (!seen[event.id]) {
        seen[event.id] = true;
        result.push(event);
      }
    });
  });
  return result;
};

export const buildWeek = (data, todayKey) => {
  const startKey = weekStartKey(todayKey);
  const allEvents = uniqueEvents([data.earlierEvents, data.todayEvents, data.upcomingEvents]);
  const days = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const key = addDays(startKey, offset);
    let phase = 'next';
    if (key < todayKey) {
      phase = 'past';
    } else if (key === todayKey) {
      phase = 'today';
    }
    const events = phase === 'today'
      ? (data.todayEvents || []).slice()
      : allEvents.filter((event) => coversDay(event, key)).sort(byStart);
    days.push({
      key,
      phase,
      events: events.map((event) => ({ event, continued: event.startDate < key })),
    });
  }
  return days;
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const eventProblem = (event) => {
  if (!event.title) return 'Write a title.';
  if (!event.calendarId) return 'Choose a calendar.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date)) return 'Write the date as YYYY-MM-DD.';
  if (event.allDay) return '';
  if (!TIME_PATTERN.test(event.start) || !TIME_PATTERN.test(event.end)) return 'Write the times as HH:MM.';
  return event.end > event.start ? '' : 'The end time must be after the start time.';
};
