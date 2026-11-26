import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deviceLabel, formatPairingCode, normalizePairingCode } from '../src/js/auth.js';

describe('deviceLabel', () => {
  it('names e-readers without the browser', () => {
    assert.equal(deviceLabel('Mozilla/5.0 (X11; U; Linux armv7l like Android; en-us) AppleWebKit/531.2+ (KHTML, like Gecko) Version/5.0 Safari/533.2+ Kindle/3.0+'), 'Kindle');
    assert.equal(deviceLabel('Mozilla/5.0 (Linux; U; en-US) AppleWebKit/534.34 (KHTML, like Gecko) PocketBook/740 Safari/534.34'), 'PocketBook');
  });

  it('names the device and the browser', () => {
    assert.equal(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'), 'Mac · Safari');
    assert.equal(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'), 'iPhone · Safari');
    assert.equal(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0'), 'Windows · Edge');
  });

  it('has a fallback', () => {
    assert.equal(deviceLabel(''), 'Browser');
  });
});

describe('pairing codes', () => {
  it('removes spaces and dashes and makes capitals', () => {
    assert.equal(normalizePairingCode(' abcd-efgh '), 'ABCDEFGH');
  });

  it('shows the code in two groups', () => {
    assert.equal(formatPairingCode('ABCDEFGH'), 'ABCD-EFGH');
  });
});
