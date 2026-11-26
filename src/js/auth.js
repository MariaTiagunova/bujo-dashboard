const DEVICE_PATTERNS = [
  [/Kindle|Silk/i, 'Kindle'],
  [/PocketBook/i, 'PocketBook'],
  [/Kobo/i, 'Kobo'],
  [/iPad/i, 'iPad'],
  [/iPhone|iPod/i, 'iPhone'],
  [/Android/i, 'Android'],
  [/Macintosh|Mac OS X/i, 'Mac'],
  [/Windows/i, 'Windows'],
  [/Linux|X11/i, 'Linux'],
];

const BROWSER_PATTERNS = [
  [/Edg\//, 'Edge'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const findName = (patterns, text) => {
  const match = patterns.find(([pattern]) => pattern.test(text));
  return match ? match[1] : '';
};

export const deviceLabel = (userAgent = '') => {
  const device = findName(DEVICE_PATTERNS, userAgent);
  const browser = findName(BROWSER_PATTERNS, userAgent);
  const isReader = ['Kindle', 'PocketBook', 'Kobo'].includes(device);
  if (!device) {
    return browser || 'Browser';
  }
  return browser && !isReader ? `${device} · ${browser}` : device;
};

export const normalizePairingCode = (input) =>
  String(input || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

export const formatPairingCode = (code) => {
  const clean = normalizePairingCode(code);
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
};
