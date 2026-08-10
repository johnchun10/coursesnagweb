import assert from 'node:assert/strict';
import test from 'node:test';
import { deduplicateDiscordProfiles } from '../src/storage.mjs';

test('deduplicates Discord recipients and prefers the canonical Discord-owned profile', () => {
  const profiles = [
    {
      PK: 'USER#legacy-google-id',
      discordUserId: '123',
      updatedAt: '2026-08-10T12:00:00.000Z'
    },
    {
      PK: 'USER#123',
      discordUserId: '123',
      updatedAt: '2026-08-09T12:00:00.000Z'
    },
    {
      PK: 'USER#456',
      discordUserId: '456',
      updatedAt: '2026-08-10T12:00:00.000Z'
    },
    {
      PK: 'USER#legacy-without-discord'
    }
  ];

  assert.deepEqual(
    deduplicateDiscordProfiles(profiles).map(profile => profile.PK).sort(),
    ['USER#123', 'USER#456']
  );
});
