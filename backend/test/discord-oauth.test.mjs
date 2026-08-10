import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DISCORD_APPLICATION_ID = '1534241192819163296';
const {
  buildDiscordAuthorizationUrl,
  publicDiscordIdentity
} = await import('../src/discord-oauth.mjs');

test('builds a scoped Discord authorization URL', () => {
  const redirectUri = 'https://example.execute-api.us-east-1.amazonaws.com/dev/discord/callback';
  const result = new URL(buildDiscordAuthorizationUrl('state-token', redirectUri));

  assert.equal(result.origin, 'https://discord.com');
  assert.equal(result.pathname, '/oauth2/authorize');
  assert.equal(result.searchParams.get('client_id'), '1534241192819163296');
  assert.equal(result.searchParams.get('response_type'), 'code');
  assert.equal(result.searchParams.get('redirect_uri'), redirectUri);
  assert.equal(result.searchParams.get('scope'), 'identify');
  assert.equal(result.searchParams.has('integration_type'), false);
  assert.equal(result.searchParams.get('state'), 'state-token');
});

test('keeps only the Discord identity fields CourseSnag needs', () => {
  assert.deepEqual(publicDiscordIdentity({
    id: '123456789',
    username: 'jochu',
    global_name: 'John',
    avatar: 'avatar-hash',
    email: 'not-stored@example.com'
  }), {
    userId: '123456789',
    username: 'jochu',
    displayName: 'John',
    avatar: 'avatar-hash'
  });
});

test('rejects an incomplete Discord identity', () => {
  assert.throws(() => publicDiscordIdentity({ id: '123456789' }), /incomplete user identity/);
});
