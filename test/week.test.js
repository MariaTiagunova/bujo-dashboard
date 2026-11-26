import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildWeek, weekStartKey } from '../src/js/bujo.js';
import { normalizeSettings } from '../src/js/settings.js';

const at = (day, hours) => new Date(2026, 10, day, hours).getTime();
const timed = (id, day, from, to) => {
  const key = `2026-11-${day}`;
  return { id, title: id, allDay: false, start: at(day, from), end: at(day, to), startDate: key, endDate: key };
};
const allDay = (id, startDate, endDate) => ({ id, title: id, allDay: true, start: 0, end: 0, startDate, endDate });

describe('weekStartKey', () => {
  it('returns Monday for a day in the middle of the week', () => {
    assert.equal(weekStartKey('2026-11-25'), '2026-11-23');
  });

  it('returns the previous Monday for a Sunday', () => {
    assert.equal(weekStartKey('2026-11-29'), '2026-11-23');
  });

  it('returns the same day for a Monday', () => {
    assert.equal(weekStartKey('2026-11-30'), '2026-11-30');
  });
});

describe('buildWeek', () => {
  const lisbon = allDay('lisbon', '2026-11-26', '2026-11-30');
  const data = {
    earlierEvents: [timed('dentist', 23, 9, 10)],
    todayEvents: [timed('call', 25, 16, 17)],
    upcomingEvents: [lisbon, timed('flight', 29, 20, 23), timed('later', 30, 9, 10)],
    oneTime: [
      { id: 'tax', title: '* Tax', done: false, due: '2026-11-24' },
      { id: 'pack', title: 'Pack', done: false, due: '2026-11-26' },
      { id: 'landlord', title: 'Call landlord', done: false, due: '' },
    ],
    repeated: [
      { id: 'fridge', title: 'Fridge', done: false, due: '2026-11-28', cycle: '1w' },
      { id: 'plant', title: 'Plant', done: true, due: '2026-11-27', cycle: '5d' },
    ],
  };
  const week = buildWeek(data, '2026-11-25');
  const ids = (day) => day.events.map((item) => item.event.id);

  it('shows no to-dos in the days', () => {
    assert.ok(week.every((day) => !('tasks' in day)));
  });

  it('makes seven days from Monday with a phase for each day', () => {
    assert.deepEqual(week.map((day) => day.key.slice(8)), ['23', '24', '25', '26', '27', '28', '29']);
    assert.deepEqual(week.map((day) => day.phase), ['past', 'past', 'today', 'next', 'next', 'next', 'next']);
  });

  it('puts earlier, today and upcoming events on their days', () => {
    assert.deepEqual(ids(week[0]), ['dentist']);
    assert.deepEqual(ids(week[2]), ['call']);
    assert.deepEqual(ids(week[6]), ['lisbon', 'flight']);
  });

  it('shows a multi-day event on each day and marks the later days as continued', () => {
    assert.deepEqual(week.map((day) => ids(day).includes('lisbon')), [false, false, false, true, true, true, true]);
    assert.equal(week[3].events[0].continued, false);
    assert.equal(week[4].events[0].continued, true);
  });

  it('works when the server sends no earlier events', () => {
    const { earlierEvents, ...rest } = data;
    assert.ok(earlierEvents.length);
    assert.deepEqual(ids(buildWeek(rest, '2026-11-25')[0]), []);
  });
});

describe('layout setting', () => {
  it('keeps a known layout and replaces an unknown layout with the default', () => {
    assert.equal(normalizeSettings({ layout: 'week' }).layout, 'week');
    assert.equal(normalizeSettings({ layout: 'grid' }).layout, 'classic');
  });
});

describe('lastDayOf', () => {
  it('uses the day before the exclusive end date of an all-day event', async () => {
    const { lastDayOf } = await import('../src/js/bujo.js');
    assert.equal(lastDayOf(allDay('trip', '2026-11-26', '2026-11-30')), '2026-11-29');
  });
});

describe('eventProblem', () => {
  const valid = { title: 'Dentist', calendarId: 'me', date: '2026-11-27', allDay: false, start: '09:00', end: '10:00' };

  it('accepts a timed event and an all-day event', async () => {
    const { eventProblem } = await import('../src/js/bujo.js');
    assert.equal(eventProblem(valid), '');
    assert.equal(eventProblem({ ...valid, allDay: true, start: '', end: '' }), '');
  });

  it('explains what is wrong', async () => {
    const { eventProblem } = await import('../src/js/bujo.js');
    assert.equal(eventProblem({ ...valid, title: '' }), 'Write a title.');
    assert.equal(eventProblem({ ...valid, calendarId: '' }), 'Choose a calendar.');
    assert.equal(eventProblem({ ...valid, date: '27/11/2026' }), 'Write the date as YYYY-MM-DD.');
    assert.equal(eventProblem({ ...valid, start: '9' }), 'Write the times as HH:MM.');
    assert.equal(eventProblem({ ...valid, end: '08:00' }), 'The end time must be after the start time.');
  });
});
