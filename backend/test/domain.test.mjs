import test from 'node:test';
import assert from 'node:assert/strict';
import {
  availabilityEventForTransition,
  groupTrackersByRosterSubject,
  normalizeTrackerInput
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

test('describes open and not-open availability transitions', () => {
  assert.equal(availabilityEventForTransition('C', 'O'), 'course-opened');
  assert.equal(availabilityEventForTransition('UNKNOWN', 'O'), 'course-opened');
  assert.equal(availabilityEventForTransition('O', 'O'), null);
  assert.equal(availabilityEventForTransition('O', 'C'), 'course-not-open');
  assert.equal(availabilityEventForTransition('UNKNOWN', 'W'), 'course-not-open');
});
