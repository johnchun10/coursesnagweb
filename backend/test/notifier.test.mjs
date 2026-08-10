import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldDeliverNotification } from '../src/notifier.mjs';

test('suppresses course alerts outside Cloud Active while preserving account and season messages', () => {
  assert.equal(shouldDeliverNotification({ type: 'course-opened' }, 'local'), false);
  assert.equal(shouldDeliverNotification({ type: 'course-not-open' }, 'stopping'), false);
  assert.equal(shouldDeliverNotification({ type: 'course-opened' }, 'cloud'), true);
  assert.equal(shouldDeliverNotification({ type: 'season-offline' }, 'local'), true);
  assert.equal(shouldDeliverNotification({ type: 'season-online' }, 'starting'), true);
  assert.equal(shouldDeliverNotification({ type: 'connection-confirmed' }, 'local'), true);
});
