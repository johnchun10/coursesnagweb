import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateTrackerCounts, deduplicateDiscordProfiles } from '../src/storage.mjs';

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

test('counts distinct Discord tracker owners for requested sections', () => {
  assert.deepEqual(aggregateTrackerCounts([
    { classNbr: '1111', userId: 'a' },
    { classNbr: '1111', userId: 'b' },
    { classNbr: '1111', userId: 'a' },
    { classNbr: '2222', userId: 'c' },
    { classNbr: '3333', userId: 'ignored' }
  ], ['1111', '2222', '4444']), {
    1111: 2,
    2222: 1,
    4444: 0
  });
});
