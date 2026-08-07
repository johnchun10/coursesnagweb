import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupTrackersByRosterSubject,
  normalizeTrackerInput,
  shouldAlertForTransition
} from '../src/domain.mjs';

test('normalizes a valid tracker from the browser shape', () => {
  const tracker = normalizeTrackerInput({
    roster: 'FA26',
    subject: 'cs',
    classNbr: 12345,
    catalogNbr: '2110',
    title: 'Object-Oriented Programming'
  });

  assert.equal(tracker.subject, 'CS');
  assert.equal(tracker.classNbr, '12345');
  assert.equal(tracker.trackerId, 'FA26:12345');
});

test('rejects malformed tracker identifiers', () => {
  assert.throws(
    () => normalizeTrackerInput({ roster: 'FA26', subject: 'CS', classNbr: '12x' }),
    /only digits/
  );
});

test('groups duplicate polling work by roster and subject', () => {
  const groups = groupTrackersByRosterSubject([
    { roster: 'FA26', subject: 'CS', classNbr: '1' },
    { roster: 'FA26', subject: 'CS', classNbr: '2' },
    { roster: 'FA26', subject: 'MATH', classNbr: '3' }
  ]);

  assert.equal(groups.size, 2);
  assert.equal(groups.get('FA26:CS').trackers.length, 2);
});

test('alerts only when a section transitions into open', () => {
  assert.equal(shouldAlertForTransition('C', 'O'), true);
  assert.equal(shouldAlertForTransition('UNKNOWN', 'O'), true);
  assert.equal(shouldAlertForTransition('O', 'O'), false);
  assert.equal(shouldAlertForTransition('O', 'C'), false);
});
