import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hasApiUrl, isConfigured, normalizeSettings, signedOut } from '../src/js/settings.js';

describe('settings', () => {
  it('limits numbers to the allowed range', () => {
    const settings = normalizeSettings({ upcomingDays: 30, refreshMinutes: -5 });
    assert.equal(settings.upcomingDays, 14);
    assert.equal(settings.refreshMinutes, 0);
  });

  it('uses defaults for bad values', () => {
    assert.equal(normalizeSettings({ upcomingDays: 'abc' }).upcomingDays, 14);
  });

  it('needs an https URL and a device token', () => {
    assert.equal(isConfigured(normalizeSettings({ apiUrl: 'https://script.google.com/x/exec', deviceToken: 'a.b' })), true);
    assert.equal(isConfigured(normalizeSettings({ apiUrl: 'http://example.com', deviceToken: 'a.b' })), false);
    assert.equal(isConfigured(normalizeSettings({ apiUrl: 'https://script.google.com/x/exec', deviceToken: ' ' })), false);
  });

  it('drops the old shared token', () => {
    const settings = normalizeSettings({ apiUrl: 'https://script.google.com/x/exec', token: 'shared' });
    assert.equal('token' in settings, false);
    assert.equal(isConfigured(settings), false);
    assert.equal(hasApiUrl(settings), true);
  });

  it('accepts only known device kinds', () => {
    assert.equal(normalizeSettings({ deviceKind: 'google' }).deviceKind, 'google');
    assert.equal(normalizeSettings({ deviceKind: 'admin' }).deviceKind, '');
  });

  it('signs out but keeps the URL and the display options', () => {
    const before = normalizeSettings({ apiUrl: 'https://x/exec', deviceToken: 'a.b', account: 'me@example.com', deviceKind: 'google', eink: true });
    const after = signedOut(before);
    assert.equal(after.deviceToken, '');
    assert.equal(after.account, '');
    assert.equal(after.apiUrl, 'https://x/exec');
    assert.equal(after.eink, true);
  });
});
