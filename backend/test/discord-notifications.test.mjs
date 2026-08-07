import assert from 'node:assert/strict';
import test from 'node:test';
import { notificationContent } from '../src/discord.mjs';

const tracker = {
  subject: 'CS',
  catalogNbr: '2110',
  title: 'Object-Oriented Programming',
  section: '001',
  classNbr: '12345'
};

test('formats tracker lifecycle messages', () => {
  assert.match(notificationContent({ type: 'tracking-added', tracker }).content, /Now tracking CS 2110/);
  assert.match(notificationContent({ type: 'tracking-removed', tracker }).content, /Stopped tracking CS 2110/);
  assert.match(notificationContent({ type: 'course-opened', tracker }).content, /CS 2110 is open/);
  assert.match(notificationContent({ type: 'course-not-open', status: 'C', tracker }).content, /CS 2110 is not open/);
  assert.match(notificationContent({ type: 'course-not-open', status: 'W', tracker }).content, /CS 2110 is waitlisted/);
});
