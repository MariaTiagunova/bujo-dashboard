// Old e-reader browsers have no Intl API, so all names and formats are local to this file.
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (value) => (value < 10 ? `0${value}` : String(value));

export const dateKeyFromDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

// Date keys are parsed by hand. Old WebKit parses ISO date strings incorrectly or not at all.
export const dateFromKey = (key) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
};

export const addDays = (key, count) => {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + count);
  return dateKeyFromDate(date);
};

export const daysBetween = (fromKey, toKey) => Math.round((dateFromKey(toKey) - dateFromKey(fromKey)) / 86400000);

export const formatTime = (ms, clock24h) => {
  const date = new Date(ms);
  const hours = date.getHours();
  const minutes = pad(date.getMinutes());
  if (clock24h) {
    return `${pad(hours)}:${minutes}`;
  }
  const suffix = hours < 12 ? 'am' : 'pm';
  return `${hours % 12 || 12}:${minutes}${suffix}`;
};

export const formatShortDate = (key) => {
  const date = dateFromKey(key);
  return `${DAY_SHORT[date.getDay()]}, ${MONTH_SHORT[date.getMonth()]} ${date.getDate()}`;
};

export const formatDayName = (key) => DAY_SHORT[dateFromKey(key).getDay()];

export const formatMonthDay = (key) => {
  const date = dateFromKey(key);
  return `${MONTH_SHORT[date.getMonth()]} ${date.getDate()}`;
};

export const formatLongDate = (date) => `${DAY_LONG[date.getDay()]}, ${MONTH_LONG[date.getMonth()]} ${date.getDate()}`;

export const isoWeek = (date) => {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target - yearStart) / 86400000 + 1) / 7);
};

export const relativeDayLabel = (todayKey, key) => {
  const diff = daysBetween(todayKey, key);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return '';
};
