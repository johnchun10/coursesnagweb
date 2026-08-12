import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStatusIndex, defaultRosterSlug, fetchCurrentRoster } from '../src/cornell.mjs';

test('indexes Cornell section statuses by class number', () => {
  const index = buildStatusIndex([{ enrollGroups: [{ classSections: [
    { classNbr: 12345, openStatus: 'O' },
    { classNbr: 54321, openStatus: 'C' }
  ] }] }]);

  assert.equal(index.get('12345'), 'O');
  assert.equal(index.get('54321'), 'C');
});

test('uses the roster Cornell marks as current', () => {
  assert.equal(defaultRosterSlug([
    { slug: 'SU26', isDefaultRoster: 'N' },
    { slug: 'FA26', isDefaultRoster: 'Y' }
  ]), 'FA26');
  assert.equal(defaultRosterSlug([{ slug: 'SP27' }]), 'SP27');
  assert.equal(defaultRosterSlug([]), '');
});

test('loads the current roster from Cornell configuration', async () => {
  const roster = await fetchCurrentRoster(async () => ({
    ok: true,
    json: async () => ({
      status: 'success',
      data: { rosters: [{ slug: 'FA26', isDefaultRoster: 'Y' }] }
    })
  }));

  assert.equal(roster, 'FA26');
});
