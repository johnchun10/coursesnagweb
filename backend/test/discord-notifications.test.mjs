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

test('formats availability messages without a website link', () => {
  assert.match(notificationContent({ type: 'course-opened', tracker }).content, /CS 2110 is open/);
  assert.match(notificationContent({ type: 'course-not-open', status: 'C', tracker }).content, /CS 2110 is not open/);
  assert.match(notificationContent({ type: 'course-not-open', status: 'W', tracker }).content, /CS 2110 is waitlisted/);
  assert.doesNotMatch(notificationContent({ type: 'course-opened', tracker }).content, /coursesnag\.pages\.dev/);
});

test('rejects tracker add and remove notifications', () => {
  assert.throws(() => notificationContent({ type: 'tracking-added', tracker }), /Unsupported/);
  assert.throws(() => notificationContent({ type: 'tracking-removed', tracker }), /Unsupported/);
});

test('formats a Discord connection confirmation', () => {
  const message = notificationContent({ type: 'connection-confirmed' }).content;
  assert.match(message, /CourseSnag is connected/);
  assert.match(message, /cloud watchlist sync and course alerts/);
  assert.doesNotMatch(message, /coursesnag\.pages\.dev/);
});

test('formats seasonal cloud status messages', () => {
  const offline = notificationContent({ type: 'season-offline' }).content;
  const online = notificationContent({ type: 'season-online' }).content;

  assert.equal(
    offline,
    'CourseSnag cloud tracking is currently **OFFLINE**. We will return before the next enrollment period!'
  );
  assert.equal(
    online,
    'CourseSnag cloud tracking is back **ONLINE**! Track your courses at https://coursesnag.pages.dev'
  );
  assert.doesNotMatch(offline, /sleep/i);
});
