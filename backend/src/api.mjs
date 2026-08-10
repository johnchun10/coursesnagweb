import { config, requireConfig } from './config.mjs';
import {
  cancelDiscordAuthorization,
  completeDiscordAuthorization,
  createDiscordAuthorization
} from './discord-oauth.mjs';
import { normalizeTrackerInput, publicTracker } from './domain.mjs';
import { sendDirectMessage } from './discord.mjs';
import { json, parseJsonBody, redirect, route } from './http.mjs';
import { currentMode } from './mode.mjs';
import {
  authenticateSession,
  createLoginCode,
  exchangeLoginCode,
  revokeSession
} from './session.mjs';
import {
  deleteTracker,
  getProfile,
  listTrackers,
  putTracker,
  upsertDiscordProfile
} from './storage.mjs';

function publicProfile(profile) {
  if (!profile) return null;
  return {
    discordConnected: Boolean(profile.discordUserId),
    discord: profile.discordUserId ? {
      username: profile.discordUsername || '',
      displayName: profile.discordDisplayName || profile.discordUsername || '',
      avatar: profile.discordAvatar || '',
      connectedAt: profile.discordConnectedAt || null
    } : null,
    updatedAt: profile.updatedAt || null
  };
}

function discordRedirectUri(event) {
  const domainName = event?.requestContext?.domainName;
  const stage = event?.requestContext?.stage;
  if (!domainName || !stage) throw new Error('Discord callback URL could not be determined.');
  const stagePath = stage === '$default' ? '' : `/${stage}`;
  return `https://${domainName}${stagePath}/discord/callback`;
}

function frontendReturn(status, values = {}) {
  requireConfig('frontendOrigin');
  const destination = new URL(config.frontendOrigin);
  destination.searchParams.set('discord', status);
  for (const [key, value] of Object.entries(values)) {
    if (value) destination.searchParams.set(key, value);
  }
  return destination.toString();
}

async function discordCallback(event) {
  const query = event.queryStringParameters || {};
  try {
    if (query.error) {
      await cancelDiscordAuthorization(query.state);
      return redirect(frontendReturn('cancelled'));
    }
    if (!query.code || !query.state) throw new Error('Discord callback is missing required values.');
    const completed = await completeDiscordAuthorization(
      query.code,
      query.state,
      discordRedirectUri(event)
    );
    try {
      await sendDirectMessage({
        type: 'connection-confirmed',
        discordUserId: completed.discord.userId,
        detectedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Discord delivery verification failed', {
        discordUserId: completed.discord.userId,
        message: error.message
      });
      return redirect(frontendReturn('delivery-unavailable'));
    }
    const profile = await upsertDiscordProfile(completed.discord);
    const loginCode = await createLoginCode(profile.discordUserId);
    return redirect(frontendReturn('connected', { code: loginCode }));
  } catch (error) {
    console.error('Discord callback failed', { message: error.message });
    return redirect(frontendReturn('error'));
  }
}

export async function handler(event) {
  const request = route(event);

  try {
    if (request.routeKey === 'GET /health') {
      return json(200, {
        status: 'ok',
        service: 'coursesnag-api',
        stage: config.stageName,
        time: new Date().toISOString()
      });
    }

    if (request.routeKey === 'GET /mode') {
      return json(200, { mode: await currentMode() });
    }

    if (request.routeKey === 'POST /auth/discord') {
      return json(200, await createDiscordAuthorization(discordRedirectUri(event)));
    }

    if (request.routeKey === 'GET /discord/callback') {
      return discordCallback(event);
    }

    if (request.routeKey === 'POST /auth/session') {
      const exchanged = await exchangeLoginCode(parseJsonBody(event).code);
      return json(201, {
        sessionToken: exchanged.sessionToken,
        expiresAt: new Date(exchanged.expiresAt * 1000).toISOString(),
        profile: publicProfile(await getProfile(exchanged.userId))
      });
    }

    const session = await authenticateSession(event);
    if (!session) return json(401, { error: 'Discord sign-in is required.' });

    if (request.routeKey === 'DELETE /session') {
      await revokeSession(session.tokenHash);
      return { statusCode: 204, headers: { 'cache-control': 'no-store' }, body: '' };
    }

    if (request.routeKey === 'GET /me') {
      return json(200, { profile: publicProfile(await getProfile(session.userId)) });
    }

    if (request.routeKey === 'GET /trackers') {
      const trackers = await listTrackers(session.userId);
      return json(200, { trackers: trackers.map(publicTracker) });
    }

    if (request.routeKey === 'POST /trackers') {
      const tracker = normalizeTrackerInput(parseJsonBody(event));
      const saved = await putTracker(session.userId, tracker);
      return json(saved.created ? 201 : 200, { tracker: publicTracker(saved.item) });
    }

    if (request.routeKey === 'DELETE /trackers/{trackerId}') {
      const trackerId = decodeURIComponent(event.pathParameters?.trackerId || '');
      if (!trackerId) return json(400, { error: 'Missing tracker ID.' });
      await deleteTracker(session.userId, trackerId);
      return { statusCode: 204, headers: { 'cache-control': 'no-store' }, body: '' };
    }

    return json(404, { error: 'Route not found.' });
  } catch (error) {
    console.error('API request failed', {
      routeKey: request.routeKey,
      message: error.message
    });
    const clientError = /Missing required field|unsupported characters|only digits|valid JSON|JSON object|login code is invalid|login expired/i.test(error.message);
    return json(clientError ? 400 : 500, {
      error: clientError ? error.message : 'The CourseSnag service could not complete this request.'
    });
  }
}
