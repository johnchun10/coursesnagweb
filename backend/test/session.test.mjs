import assert from 'node:assert/strict';
import test from 'node:test';
import { bearerToken, secretHash } from '../src/session.mjs';

test('reads a CourseSnag bearer token', () => {
  const token = 'a'.repeat(43);
  assert.equal(bearerToken({ headers: { authorization: `Bearer ${token}` } }), token);
  assert.equal(bearerToken({ headers: { authorization: 'Basic nope' } }), '');
});

test('hashes opaque credentials before storage', () => {
  assert.equal(secretHash('secret').length, 64);
  assert.notEqual(secretHash('secret'), 'secret');
});
