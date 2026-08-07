import { randomBytes } from 'node:crypto';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { config, requireConfig } from './config.mjs';
import {
  consumeDiscordOAuthState,
  putDiscordOAuthState
} from './storage.mjs';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const STATE_LIFETIME_SECONDS = 10 * 60;
const ssm = new SSMClient({});
let cachedClientSecret;

async function clientSecret() {
  if (cachedClientSecret) return cachedClientSecret;
  requireConfig('discordClientSecretParameter');
  const result = await ssm.send(new GetParameterCommand({
    Name: config.discordClientSecretParameter,
    WithDecryption: true
  }));
  if (!result.Parameter?.Value) throw new Error('Discord client secret is not configured.');
  cachedClientSecret = result.Parameter.Value;
  return cachedClientSecret;
}

function basicAuthorization(secret) {
  return `Basic ${Buffer.from(`${config.discordApplicationId}:${secret}`).toString('base64')}`;
}

async function discordFormRequest(path, values) {
  requireConfig('discordApplicationId');
  const secret = await clientSecret();
  const response = await fetch(`${DISCORD_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: basicAuthorization(secret),
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'CourseSnag (https://coursesnag.pages.dev, 0.1)'
    },
    body: new URLSearchParams(values),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Discord OAuth returned HTTP ${response.status}: ${detail}`);
  }
  return response.status === 204 ? null : response.json();
}

async function discordUser(accessToken) {
  const response = await fetch(`${DISCORD_API_BASE}/users/@me`, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
      'user-agent': 'CourseSnag (https://coursesnag.pages.dev, 0.1)'
    },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Discord identity request returned HTTP ${response.status}: ${detail}`);
  }
  return response.json();
}

async function revokeAccessToken(accessToken) {
  try {
    await discordFormRequest('/oauth2/token/revoke', {
      token: accessToken,
      token_type_hint: 'access_token'
    });
  } catch (error) {
    console.warn('Discord access-token revocation failed', { message: error.message });
  }
}

export function buildDiscordAuthorizationUrl(state, redirectUri) {
  requireConfig('discordApplicationId');
  const query = new URLSearchParams({
    client_id: config.discordApplicationId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'identify applications.commands',
    integration_type: '1',
    state,
    prompt: 'consent'
  });
  return `https://discord.com/oauth2/authorize?${query}`;
}

export function publicDiscordIdentity(user) {
  if (!user?.id || !user?.username) throw new Error('Discord returned an incomplete user identity.');
  return {
    userId: String(user.id),
    username: String(user.username),
    displayName: String(user.global_name || user.username),
    avatar: user.avatar ? String(user.avatar) : ''
  };
}

export async function createDiscordAuthorization(redirectUri) {
  requireConfig('discordApplicationId', 'discordClientSecretParameter');
  await clientSecret();
  const state = randomBytes(32).toString('base64url');
  await putDiscordOAuthState(state, STATE_LIFETIME_SECONDS);
  return {
    authorizationUrl: buildDiscordAuthorizationUrl(state, redirectUri),
    expiresIn: STATE_LIFETIME_SECONDS
  };
}

export async function cancelDiscordAuthorization(state) {
  if (state) await consumeDiscordOAuthState(state);
}

export async function completeDiscordAuthorization(code, state, redirectUri) {
  const pending = await consumeDiscordOAuthState(state);
  if (!pending) throw new Error('Discord authorization expired or was already used.');

  const token = await discordFormRequest('/oauth2/token', {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  });
  if (!token?.access_token) throw new Error('Discord did not return an access token.');

  try {
    return {
      discord: publicDiscordIdentity(await discordUser(token.access_token))
    };
  } finally {
    await revokeAccessToken(token.access_token);
  }
}
