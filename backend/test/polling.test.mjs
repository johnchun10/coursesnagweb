import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MONITOR_TIME_ZONE,
  monitorPollIsDue,
  monitorTransitionId,
  pollingIntervalMinutesAt
} from '../src/polling.mjs';

test('uses the approved half-refresh schedule in New York time', () => {
  assert.equal(MONITOR_TIME_ZONE, 'America/New_York');
  assert.equal(pollingIntervalMinutesAt(new Date('2026-08-17T09:59:00Z')), 30); // 05:59 EDT
  assert.equal(pollingIntervalMinutesAt(new Date('2026-08-17T10:00:00Z')), 5); // 06:00 EDT
  assert.equal(pollingIntervalMinutesAt(new Date('2026-08-17T20:59:00Z')), 5); // 16:59 EDT
  assert.equal(pollingIntervalMinutesAt(new Date('2026-08-17T21:00:00Z')), 10); // 17:00 EDT
  assert.equal(pollingIntervalMinutesAt(new Date('2026-08-18T03:59:00Z')), 10); // 23:59 EDT
  assert.equal(pollingIntervalMinutesAt(new Date('2026-08-18T04:00:00Z')), 30); // 00:00 EDT
});

test('honors New York daylight-saving time without changing the schedule windows', () => {
  assert.equal(pollingIntervalMinutesAt(new Date('2026-01-15T11:00:00Z')), 5); // 06:00 EST
  assert.equal(pollingIntervalMinutesAt(new Date('2026-07-15T10:00:00Z')), 5); // 06:00 EDT
});

test('runs immediately when forced or when no prior poll is recorded', () => {
  const now = new Date('2026-08-17T15:00:00Z');
  assert.equal(monitorPollIsDue(null, now), true);
  assert.equal(monitorPollIsDue('2026-08-17T14:59:00.000Z', now, true), true);
});

test('uses the interval for the current time window', () => {
  assert.equal(
    monitorPollIsDue('2026-08-17T14:55:00.000Z', new Date('2026-08-17T15:00:00.000Z')),
    true
  );
  assert.equal(
    monitorPollIsDue('2026-08-17T21:53:00.000Z', new Date('2026-08-17T22:00:00.000Z')),
    false
  );
  assert.equal(
    monitorPollIsDue('2026-08-17T21:50:00.000Z', new Date('2026-08-17T22:00:00.000Z')),
    true
  );
});

test('builds stable transition identities that change after a later observation', () => {
  const tracker = {
    userId: '123',
    roster: 'FA26',
    classNbr: '4567',
    lastStatus: 'C',
    lastCheckedAt: '2026-08-17T12:00:00.000Z'
  };
  const first = monitorTransitionId(tracker, 'course-opened', 'O');
  assert.equal(first, monitorTransitionId(tracker, 'course-opened', 'O'));
  assert.notEqual(first, monitorTransitionId({
    ...tracker,
    lastCheckedAt: '2026-08-17T12:10:00.000Z'
  }, 'course-opened', 'O'));
});
