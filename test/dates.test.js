import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays, daysBetween, formatShortDate, formatTime, isoWeek, relativeDayLabel } from '../src/js/dates.js';

describe('dates', () => {
  it('adds days across a month end', () => {
    assert.equal(addDays('2026-11-29', 3), '2026-12-02');
  });

  it('counts days between keys', () => {
    assert.equal(daysBetween('2026-11-22', '2026-12-06'), 14);
  });

  it('formats short dates without Intl', () => {
    assert.equal(formatShortDate('2026-11-23'), 'Mon, Nov 23');
  });

  it('formats 24-hour and 12-hour times', () => {
    const ms = new Date(2026, 10, 22, 15, 5).getTime();
    assert.equal(formatTime(ms, true), '15:05');
    assert.equal(formatTime(ms, false), '3:05pm');
    assert.equal(formatTime(new Date(2026, 10, 22, 0, 30).getTime(), false), '12:30am');
  });

  it('gives the ISO week number', () => {
    assert.equal(isoWeek(new Date(2026, 10, 22)), 47);
    assert.equal(isoWeek(new Date(2027, 0, 1)), 53);
  });

  it('names nearby days', () => {
    assert.equal(relativeDayLabel('2026-11-22', '2026-11-23'), 'Tomorrow');
    assert.equal(relativeDayLabel('2026-11-22', '2026-11-25'), '');
  });
});
