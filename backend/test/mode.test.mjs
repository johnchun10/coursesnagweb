import assert from 'node:assert/strict';
import test from 'node:test';
import { cloudMonitoringIsActive } from '../src/mode.mjs';

test('treats only the stable internal cloud value as Discord Active monitoring', () => {
  assert.equal(cloudMonitoringIsActive('cloud'), true);
  assert.equal(cloudMonitoringIsActive('local'), false);
  assert.equal(cloudMonitoringIsActive('starting'), false);
  assert.equal(cloudMonitoringIsActive('stopping'), false);
});
