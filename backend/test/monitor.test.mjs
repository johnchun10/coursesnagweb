import assert from 'node:assert/strict';
import test from 'node:test';
import {
  monitorStatusForFailures,
  partitionTrackersForRoster,
  rotateMonitorGroups
} from '../src/monitor.mjs';

test('marks any Cornell group failure as a degraded monitor run', () => {
  assert.equal(monitorStatusForFailures(0), 'ok');
  assert.equal(monitorStatusForFailures(1), 'degraded');
  assert.equal(monitorStatusForFailures(3), 'degraded');
  assert.equal(monitorStatusForFailures(0, 2), 'degraded');
});

test('separates trackers outside Cornell current roster for removal', () => {
  const trackers = [
    { trackerId: 'FA26:1', roster: 'FA26' },
    { trackerId: 'SP26:2', roster: 'SP26' },
    { trackerId: 'FA26:3', roster: 'FA26' }
  ];

  const result = partitionTrackersForRoster(trackers, 'FA26');

  assert.deepEqual(result.current.map(item => item.trackerId), ['FA26:1', 'FA26:3']);
  assert.deepEqual(result.expired.map(item => item.trackerId), ['SP26:2']);
});

test('rotates monitor groups after a partial run so later subjects cannot starve', () => {
  const groups = new Map([
    ['FA26:AEM', { subject: 'AEM' }],
    ['FA26:CS', { subject: 'CS' }],
    ['FA26:MATH', { subject: 'MATH' }]
  ]);

  assert.deepEqual(
    rotateMonitorGroups(groups, 'FA26:CS').map(([key]) => key),
    ['FA26:MATH', 'FA26:AEM', 'FA26:CS']
  );
});
