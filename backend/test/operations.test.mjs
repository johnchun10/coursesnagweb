import assert from 'node:assert/strict';
import test from 'node:test';
import { seasonMessages } from '../src/operations.mjs';

test('gives every seasonal transition and recipient a unique queue identity', () => {
  const profiles = [
    { discordUserId: '111' },
    { discordUserId: '222' }
  ];
  const firstOffline = seasonMessages(profiles, 'season-offline', 'transition-one');
  const secondOffline = seasonMessages(profiles, 'season-offline', 'transition-two');

  assert.notEqual(firstOffline[0].eventId, firstOffline[1].eventId);
  assert.notEqual(firstOffline[0].eventId, secondOffline[0].eventId);
  assert.match(firstOffline[0].eventId, /season-offline:transition-one:111/);
});
