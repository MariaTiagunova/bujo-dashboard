import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  describeCycle,
  dueInfo,
  eventPhase,
  groupUpcoming,
  isMultiDay,
  nowMarkerIndex,
  parseTitle,
  progressBar,
  sortTasks,
} from '../src/js/bujo.js';

const at = (hours, minutes = 0) => new Date(2026, 10, 22, hours, minutes).getTime();
const timed = (title, start, end) => ({ title, allDay: false, start, end, startDate: '2026-11-22', endDate: '2026-11-22' });

describe('progressBar', () => {
  it('draws one cell for each task', () => {
    assert.equal(progressBar(3, 6), '[■■■□□□] 3/6');
  });

  it('scales long lists to the maximum width', () => {
    assert.equal(progressBar(10, 20), '[■■■■■□□□□□] 10/20');
  });

  it('fills all cells when all tasks are done', () => {
    assert.equal(progressBar(13, 13), '[■■■■■■■■■■] 13/13');
  });

  it('handles an empty list', () => {
    assert.equal(progressBar(0, 0), '[] 0/0');
  });
});

describe('parseTitle', () => {
  it('finds the priority signifier and removes it', () => {
    assert.deepEqual(parseTitle('* Pay rent'), { text: 'Pay rent', priority: true });
    assert.deepEqual(parseTitle('!Call mum'), { text: 'Call mum', priority: true });
  });

  it('keeps normal titles', () => {
    assert.deepEqual(parseTitle('Water plants'), { text: 'Water plants', priority: false });
  });
});

describe('today events', () => {
  const events = [
    { title: 'Holiday', allDay: true, start: 0, end: 0, startDate: '2026-11-22', endDate: '2026-11-23' },
    timed('Standup', at(9), at(9, 15)),
    timed('Focus', at(10), at(12)),
    timed('Dinner', at(19), at(21)),
  ];

  it('gives each event a phase', () => {
    assert.deepEqual(events.map((event) => eventPhase(event, at(11))), ['allday', 'past', 'now', 'next']);
  });

  it('puts the now marker before the first event that is not finished', () => {
    assert.equal(nowMarkerIndex(events, at(8)), 1);
    assert.equal(nowMarkerIndex(events, at(11)), 2);
    assert.equal(nowMarkerIndex(events, at(22)), 4);
  });

  it('shows no marker when there are only all-day events', () => {
    assert.equal(nowMarkerIndex([events[0]], at(11)), -1);
  });
});

describe('groupUpcoming', () => {
  it('groups by date and moves events that started earlier to the first day', () => {
    const events = [
      { title: 'Trip', allDay: true, startDate: '2026-11-21', endDate: '2026-11-25' },
      { title: 'Dentist', allDay: false, startDate: '2026-11-24', endDate: '2026-11-24' },
      { title: 'Far away', allDay: false, startDate: '2026-12-20', endDate: '2026-12-20' },
    ];
    const groups = groupUpcoming(events, '2026-11-22', 7);
    assert.deepEqual(groups.map((group) => [group.key, group.events.map((event) => event.title)]), [
      ['2026-11-23', ['Trip']],
      ['2026-11-24', ['Dentist']],
    ]);
  });
});

describe('isMultiDay', () => {
  it('uses the exclusive end date of all-day events', () => {
    assert.equal(isMultiDay({ allDay: true, startDate: '2026-11-22', endDate: '2026-11-23' }), false);
    assert.equal(isMultiDay({ allDay: true, startDate: '2026-11-22', endDate: '2026-11-24' }), true);
  });
});

describe('describeCycle', () => {
  it('writes the cycle in words', () => {
    assert.equal(describeCycle('1w'), 'every week');
    assert.equal(describeCycle('3d'), 'every 3 days');
    assert.equal(describeCycle('1m'), 'every month');
    assert.equal(describeCycle('bad'), 'repeats');
  });
});

describe('dueInfo', () => {
  it('marks overdue tasks', () => {
    assert.deepEqual(dueInfo('2026-11-20', '2026-11-22'), { text: 'overdue · Nov 20', overdue: true });
    assert.deepEqual(dueInfo('2026-11-22', '2026-11-22'), { text: 'due today', overdue: false });
    assert.equal(dueInfo('', '2026-11-22'), null);
  });
});

describe('sortTasks', () => {
  it('puts priority tasks first and done tasks last, and keeps the order in each group', () => {
    const tasks = [
      { title: 'b', done: true },
      { title: 'c', done: false },
      { title: '* a', done: false },
      { title: 'd', done: false },
    ];
    assert.deepEqual(sortTasks(tasks).map((task) => task.title), ['* a', 'c', 'd', 'b']);
  });
});
