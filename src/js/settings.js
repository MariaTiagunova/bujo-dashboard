import { readJson, writeJson } from './storage.js';

const SETTINGS_KEY = 'bujo.settings.v1';

export const DEFAULT_SETTINGS = {
  apiUrl: '',
  deviceToken: '',
  account: '',
  deviceKind: '',
  upcomingDays: 14,
  refreshMinutes: 15,
  clock24h: true,
  eink: false,
  layout: 'classic',
  eventCalendarId: '',
};

export const LAYOUTS = ['classic', 'week'];

const clamp = (value, min, max, fallback) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

export const normalizeSettings = (input = {}) => ({
  apiUrl: String(input.apiUrl ?? DEFAULT_SETTINGS.apiUrl).trim(),
  deviceToken: String(input.deviceToken ?? DEFAULT_SETTINGS.deviceToken).trim(),
  account: String(input.account ?? DEFAULT_SETTINGS.account),
  deviceKind: input.deviceKind === 'google' || input.deviceKind === 'paired' ? input.deviceKind : '',
  upcomingDays: clamp(input.upcomingDays, 7, 14, DEFAULT_SETTINGS.upcomingDays),
  refreshMinutes: clamp(input.refreshMinutes, 0, 240, DEFAULT_SETTINGS.refreshMinutes),
  clock24h: input.clock24h ?? DEFAULT_SETTINGS.clock24h,
  eink: Boolean(input.eink),
  layout: LAYOUTS.includes(input.layout) ? input.layout : DEFAULT_SETTINGS.layout,
  eventCalendarId: String(input.eventCalendarId ?? DEFAULT_SETTINGS.eventCalendarId),
});

export const loadSettings = () => normalizeSettings({ ...DEFAULT_SETTINGS, ...readJson(SETTINGS_KEY, {}) });

export const saveSettings = (settings) => {
  const clean = normalizeSettings(settings);
  writeJson(SETTINGS_KEY, clean);
  return clean;
};

export const hasApiUrl = (settings) => /^https:\/\//.test(settings.apiUrl);

export const isConfigured = (settings) => hasApiUrl(settings) && settings.deviceToken.length > 0;

export const signedOut = (settings) => ({ ...settings, deviceToken: '', account: '', deviceKind: '' });
