import assert from 'node:assert/strict';
import test from 'node:test';
import { monitorStatusForFailures } from '../src/monitor.mjs';

test('marks any Cornell group failure as a degraded monitor run', () => {
  assert.equal(monitorStatusForFailures(0), 'ok');
  assert.equal(monitorStatusForFailures(1), 'degraded');
  assert.equal(monitorStatusForFailures(3), 'degraded');
});
