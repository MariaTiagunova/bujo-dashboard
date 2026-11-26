import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
const CLIENT_ID = 'client-123.apps.googleusercontent.com';
const OWNER = 'owner@example.com';

const CALENDARS = [
  ['family@group.calendar.google.com', 'Семья'],
  [OWNER, 'Maria'],
  ['birthdays@group.v.calendar.google.com', 'Birthdays'],
];

const toSignedBytes = (buffer) => Array.from(buffer, (byte) => (byte > 127 ? byte - 256 : byte));

const createServer = () => {
  const props = new Map([
    ['CLIENT_ID', CLIENT_ID],
    ['ALLOWED_EMAIL', OWNER],
  ]);
  const cache = new Map();
  const created = [];
  const calendarMock = (id, name) => ({
    getId: () => id,
    getName: () => name,
    getColor: () => '#7986CB',
    getTimeZone: () => 'America/Toronto',
    isOwnedByMe: () => id !== 'birthdays@group.v.calendar.google.com',
    createEvent: (title, start, end) => {
      created.push({ calendar: id, title, start, end });
      return { getId: () => 'new-event' };
    },
    createAllDayEvent: (title, date) => {
      created.push({ calendar: id, title, date });
      return { getId: () => 'new-event' };
    },
  });
  const google = { status: 200, info: null };
  const context = {
    console,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => (props.has(key) ? props.get(key) : null),
        setProperty: (key, value) => props.set(key, String(value)),
        deleteProperty: (key) => props.delete(key),
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (key) => (cache.has(key) ? cache.get(key) : null),
        put: (key, value) => cache.set(key, String(value)),
        remove: (key) => cache.delete(key),
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => OWNER }), getScriptTimeZone: () => 'Etc/UTC' },
    CalendarApp: {
      getDefaultCalendar: () => calendarMock(OWNER, 'Maria'),
      getAllCalendars: () => CALENDARS.map(([id, name]) => calendarMock(id, name)),
      getCalendarById: (id) => {
        const found = CALENDARS.find((item) => item[0] === id);
        return found ? calendarMock(found[0], found[1]) : null;
      },
    },
    Utilities: {
      getUuid: () => randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (_algorithm, text) => toSignedBytes(createHash('sha256').update(String(text), 'utf8').digest()),
      formatDate: () => '2026-11-22',
      parseDate: (text, tz) => ({ text, tz }),
    },
    UrlFetchApp: {
      fetch: (url, options) => {
        google.lastRequest = { url, options };
        return {
          getResponseCode: () => google.status,
          getContentText: () => JSON.stringify(google.info),
        };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(SOURCE, context);
  const call = (request) => {
    try {
      return JSON.parse(JSON.stringify(context.handle(request)));
    } catch (error) {
      return JSON.parse(JSON.stringify(context.failure(error)));
    }
  };
  return { call, props, cache, google, created };
};

const validInfo = (overrides = {}) => ({
  aud: CLIENT_ID,
  iss: 'https://accounts.google.com',
  email: OWNER,
  email_verified: 'true',
  exp: String(Math.floor(Date.now() / 1000) + 3600),
  ...overrides,
});

describe('Apps Script access control', () => {
  let server;

  const signIn = () => {
    server.google.info = validInfo();
    return server.call({ action: 'signIn', idToken: 'id-token', label: 'Mac' }).data.deviceToken;
  };

  beforeEach(() => {
    server = createServer();
  });

  it('gives the client ID without a sign-in', () => {
    assert.deepEqual(server.call({ action: 'config' }), { ok: true, data: { clientId: CLIENT_ID } });
  });

  it('refuses data requests without a device token', () => {
    const result = server.call({ action: 'dashboard' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'auth');
  });

  it('refuses the old shared token', () => {
    server.props.set('TOKEN', 'shared');
    assert.equal(server.call({ action: 'ping', token: 'shared' }).code, 'auth');
  });

  it('signs in the allowed Google account and accepts its device token', () => {
    const deviceToken = signIn();
    assert.equal(server.google.lastRequest.options.method, 'post');
    const result = server.call({ action: 'ping', deviceToken });
    assert.equal(result.ok, true);
    assert.equal(result.data.account, OWNER);
  });

  it('compares the email without case', () => {
    server.google.info = validInfo({ email: 'Owner@Example.com' });
    assert.equal(server.call({ action: 'signIn', idToken: 'x' }).ok, true);
  });

  const rejected = {
    'another account': { email: 'someone@example.com' },
    'another OAuth client': { aud: 'other-client' },
    'an unverified email': { email_verified: 'false' },
    'another issuer': { iss: 'https://evil.example.com' },
    'an expired token': { exp: String(Math.floor(Date.now() / 1000) - 10) },
  };
  Object.keys(rejected).forEach((name) => {
    it(`refuses ${name}`, () => {
      server.google.info = validInfo(rejected[name]);
      const result = server.call({ action: 'signIn', idToken: 'x' });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'auth');
      assert.equal(server.props.get('DEVICES'), undefined);
    });
  });

  it('refuses a token that Google does not accept', () => {
    server.google.status = 400;
    server.google.info = { error: 'invalid_token' };
    assert.equal(server.call({ action: 'signIn', idToken: 'x' }).code, 'auth');
  });

  it('refuses a device token with a wrong secret', () => {
    const [id] = signIn().split('.');
    assert.equal(server.call({ action: 'ping', deviceToken: `${id}.wrong` }).code, 'auth');
  });

  it('stores only a hash of the device secret', () => {
    const [, secret] = signIn().split('.');
    assert.equal(server.props.get('DEVICES').includes(secret), false);
  });

  it('refuses all devices when the allowed account changes', () => {
    const deviceToken = signIn();
    server.props.set('ALLOWED_EMAIL', 'new@example.com');
    assert.equal(server.call({ action: 'ping', deviceToken }).code, 'auth');
  });

  it('refuses and removes a device that was not used for too long', () => {
    const deviceToken = signIn();
    const [id] = deviceToken.split('.');
    const devices = JSON.parse(server.props.get('DEVICES'));
    devices[id].lastUsed = Date.now() - 91 * 24 * 60 * 60 * 1000;
    server.props.set('DEVICES', JSON.stringify(devices));
    assert.equal(server.call({ action: 'ping', deviceToken }).code, 'auth');
    assert.deepEqual(JSON.parse(server.props.get('DEVICES')), {});
  });

  describe('pairing', () => {
    it('pairs a device one time with a code from a signed-in device', () => {
      const owner = signIn();
      const { code } = server.call({ action: 'createPairingCode', deviceToken: owner }).data;
      assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);

      const typed = `${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`;
      const paired = server.call({ action: 'pair', code: typed, label: 'Kindle' });
      assert.equal(paired.ok, true);
      assert.equal(paired.data.kind, 'paired');
      assert.equal(server.call({ action: 'ping', deviceToken: paired.data.deviceToken }).ok, true);

      assert.equal(server.call({ action: 'pair', code }).code, 'auth');
    });

    it('does not let a paired device make codes or see devices', () => {
      const owner = signIn();
      const { code } = server.call({ action: 'createPairingCode', deviceToken: owner }).data;
      const reader = server.call({ action: 'pair', code }).data.deviceToken;
      assert.equal(server.call({ action: 'createPairingCode', deviceToken: reader }).ok, false);
      assert.equal(server.call({ action: 'listDevices', deviceToken: reader }).ok, false);
    });

    it('stops pairing after too many incorrect codes', () => {
      const owner = signIn();
      const { code } = server.call({ action: 'createPairingCode', deviceToken: owner }).data;
      for (let i = 0; i < 10; i += 1) {
        server.call({ action: 'pair', code: 'AAAAAAAA' });
      }
      const result = server.call({ action: 'pair', code });
      assert.equal(result.ok, false);
      assert.match(result.error, /Too many/);
    });
  });

  describe('device management', () => {
    it('lists devices and revokes one', () => {
      const owner = signIn();
      const { code } = server.call({ action: 'createPairingCode', deviceToken: owner }).data;
      const reader = server.call({ action: 'pair', code, label: 'PocketBook' }).data.deviceToken;

      const list = server.call({ action: 'listDevices', deviceToken: owner }).data;
      assert.deepEqual(list.map((device) => device.label).sort(), ['Mac', 'PocketBook']);
      assert.equal(list.find((device) => device.current).label, 'Mac');
      assert.equal(JSON.stringify(list).includes('hash'), false);

      server.call({ action: 'revokeDevice', deviceToken: owner, id: reader.split('.')[0] });
      assert.equal(server.call({ action: 'ping', deviceToken: reader }).code, 'auth');
      assert.equal(server.call({ action: 'ping', deviceToken: owner }).ok, true);
    });

    it('lets a paired device sign itself out but not other devices', () => {
      const owner = signIn();
      const { code } = server.call({ action: 'createPairingCode', deviceToken: owner }).data;
      const reader = server.call({ action: 'pair', code }).data.deviceToken;

      assert.equal(server.call({ action: 'revokeDevice', deviceToken: reader, id: owner.split('.')[0] }).ok, false);
      assert.equal(server.call({ action: 'signOut', deviceToken: reader }).ok, true);
      assert.equal(server.call({ action: 'ping', deviceToken: reader }).code, 'auth');
      assert.equal(server.call({ action: 'ping', deviceToken: owner }).ok, true);
    });
  });

  describe('calendars', () => {
    const selectedNames = (result) => result.data.filter((calendar) => calendar.selected).map((calendar) => calendar.name);

    it('lists all calendars with the default calendar first and selected', () => {
      const result = server.call({ action: 'listCalendars', deviceToken: signIn() });
      assert.deepEqual(result.data.map((calendar) => calendar.name), ['Maria', 'Birthdays', 'Семья']);
      assert.deepEqual(selectedNames(result), ['Maria']);
    });

    it('saves the chosen calendars and ignores unknown ids', () => {
      const deviceToken = signIn();
      const ids = ['family@group.calendar.google.com', OWNER, 'unknown@example.com'];
      const result = server.call({ action: 'setCalendars', deviceToken, ids });
      assert.deepEqual(selectedNames(result), ['Maria', 'Семья']);
      assert.equal(server.props.get('CALENDAR_IDS'), `family@group.calendar.google.com,${OWNER}`);
    });

    it('refuses an empty choice', () => {
      const result = server.call({ action: 'setCalendars', deviceToken: signIn(), ids: [] });
      assert.equal(result.ok, false);
      assert.equal(server.props.get('CALENDAR_IDS'), undefined);
    });

    it('does not let a paired device change the calendars', () => {
      const owner = signIn();
      const { code } = server.call({ action: 'createPairingCode', deviceToken: owner }).data;
      const reader = server.call({ action: 'pair', code }).data.deviceToken;
      assert.equal(server.call({ action: 'listCalendars', deviceToken: reader }).ok, true);
      assert.equal(server.call({ action: 'setCalendars', deviceToken: reader, ids: [OWNER] }).ok, false);
    });
  });

  describe('creating events', () => {
    const create = (overrides = {}) =>
      server.call({
        action: 'createEvent',
        deviceToken: signIn(),
        calendarId: OWNER,
        title: ' Dentist ',
        date: '2026-11-27',
        allDay: false,
        start: '09:00',
        end: '10:30',
        ...overrides,
      });

    it('creates a timed event in the time zone of the calendar', () => {
      assert.deepEqual(create().data, { id: 'new-event' });
      assert.deepEqual(server.created, [{
        calendar: OWNER,
        title: 'Dentist',
        start: { text: '2026-11-27 09:00:00', tz: 'America/Toronto' },
        end: { text: '2026-11-27 10:30:00', tz: 'America/Toronto' },
      }]);
    });

    it('creates an all-day event', () => {
      assert.equal(create({ allDay: true, start: '', end: '' }).ok, true);
      assert.equal(server.created[0].title, 'Dentist');
      assert.ok(server.created[0].date);
    });

    it('accepts only calendars that the dashboard shows', () => {
      server.props.set('CALENDAR_IDS', OWNER);
      assert.equal(create({ calendarId: 'family@group.calendar.google.com' }).ok, false);
      assert.equal(server.created.length, 0);
    });

    it('refuses a calendar that the account does not own', () => {
      server.props.set('CALENDAR_IDS', 'birthdays@group.v.calendar.google.com');
      assert.equal(create({ calendarId: 'birthdays@group.v.calendar.google.com' }).ok, false);
    });

    const invalid = {
      'an empty title': { title: '  ' },
      'an incorrect date': { date: '27.11.2026' },
      'an incorrect time': { start: '9am' },
      'an end before the start': { start: '11:00', end: '10:00' },
    };
    Object.keys(invalid).forEach((name) => {
      it(`refuses ${name}`, () => {
        assert.equal(create(invalid[name]).ok, false);
        assert.equal(server.created.length, 0);
      });
    });
  });
});
