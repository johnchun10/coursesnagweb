import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import {
  trackedCoursesContent,
  unavailableCommandContent,
  unlinkedAccountPrompt,
  verifyInteractionSignature
} from '../src/interactions.mjs';

test('verifies current Discord interaction signatures', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicDer = publicKey.export({ format: 'der', type: 'spki' });
  const rawPublicKey = publicDer.subarray(-32).toString('hex');
  const body = JSON.stringify({ type: 1 });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign(
    null,
    Buffer.from(`${timestamp}${body}`, 'utf8'),
    privateKey
  ).toString('hex');

  assert.equal(verifyInteractionSignature({
    body,
    signature,
    timestamp,
    publicKey: rawPublicKey,
    nowSeconds: Number(timestamp)
  }), true);
  assert.equal(verifyInteractionSignature({
    body: `${body} `,
    signature,
    timestamp,
    publicKey: rawPublicKey,
    nowSeconds: Number(timestamp)
  }), false);
  assert.equal(verifyInteractionSignature({
    body,
    signature,
    timestamp,
    publicKey: rawPublicKey,
    nowSeconds: Number(timestamp) + 301
  }), false);
});

test('formats a private tracked-course summary', () => {
  const content = trackedCoursesContent([{
    roster: 'FA26',
    subject: 'CS',
    catalogNbr: '2110',
    title: 'Object-Oriented Programming',
    section: '001',
    classNbr: '12345',
    lastStatus: 'O'
  }]);

  assert.match(content, /Tracked courses \(1\)/);
  assert.match(content, /CS 2110/);
  assert.match(content, /OPEN/);
  assert.doesNotMatch(content, /Class #/);
  assert.doesNotMatch(content, /12345/);
  assert.doesNotMatch(content, /coursesnag\.pages\.dev/);
  assert.match(trackedCoursesContent([]), /cloud watchlist is empty/);
});

test('uses a generic response for a command cached during shutdown', () => {
  const content = unavailableCommandContent();
  assert.match(content, /currently unavailable/);
  assert.doesNotMatch(content, /OFFLINE/);
});

test('directs an unlinked Discord user to CourseSnag setup', () => {
  const prompt = unlinkedAccountPrompt();
  assert.match(prompt.content, /not linked/);
  assert.match(prompt.content, /\/tracked/);
  assert.equal(prompt.components[0].components[0].label, 'Set up CourseSnag');
  assert.equal(
    prompt.components[0].components[0].url,
    'https://coursesnag.pages.dev/?setup=discord'
  );
});
