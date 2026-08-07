import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStatusIndex } from '../src/cornell.mjs';

test('indexes Cornell section statuses by class number', () => {
  const index = buildStatusIndex([{ enrollGroups: [{ classSections: [
    { classNbr: 12345, openStatus: 'O' },
    { classNbr: 54321, openStatus: 'C' }
  ] }] }]);

  assert.equal(index.get('12345'), 'O');
  assert.equal(index.get('54321'), 'C');
});
