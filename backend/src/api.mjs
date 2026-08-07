import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { config, requireConfig } from './config.mjs';
import {
  cancelDiscordAuthorization,
  completeDiscordAuthorization,
  createDiscordAuthorization
} from './discord-oauth.mjs';
import { normalizeTrackerInput, publicTracker } from './domain.mjs';
import { json, parseJsonBody, redirect, route, userClaims } from './http.mjs';
import {
  deleteDiscordConnection,
  deleteTracker,
  getProfile,
  listTrackers,
  putTracker,
  upsertDiscordConnection,
  upsertProfileFromClaims
} from './storage.mjs';

const ssm = new SSMClient({});

async function currentMode() {
  requireConfig('modeParameterName');
  const result = await ssm.send(new GetParameterCommand({ Name: config.modeParameterName }));
  return result.Parameter?.Value || 'local';
}

function publicProfile(profile) {
  if (!profile) return null;
  const discordConnected = Boolean(profile.discordUserId);
  return {
    email: profile.googleEmail || '',
    name: profile.googleName || '',
    picture: profile.googlePicture || '',
    discordConnected,
    discord: discordConnected ? {
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

function frontendReturn(status) {
  requireConfig('frontendOrigin');
  const destination = new URL(config.frontendOrigin);
  destination.searchParams.set('discord', status);
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
    await upsertDiscordConnection(completed.googleUserId, completed.discord);
    return redirect(frontendReturn('connected'));
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

    if (request.routeKey === 'GET /discord/callback') {
      return discordCallback(event);
    }

    const claims = userClaims(event);

    if (request.routeKey === 'GET /me') {
      return json(200, { profile: publicProfile(await getProfile(claims.sub)) });
    }

    if (request.routeKey === 'PUT /me') {
      return json(200, { profile: publicProfile(await upsertProfileFromClaims(claims)) });
    }

    if (request.routeKey === 'POST /discord/connect') {
      await upsertProfileFromClaims(claims);
      return json(200, await createDiscordAuthorization(claims.sub, discordRedirectUri(event)));
    }

    if (request.routeKey === 'DELETE /discord') {
      return json(200, { profile: publicProfile(await deleteDiscordConnection(claims.sub)) });
    }

    if (request.routeKey === 'GET /trackers') {
      const trackers = await listTrackers(claims.sub);
      return json(200, { trackers: trackers.map(publicTracker) });
    }

    if (request.routeKey === 'POST /trackers') {
      await upsertProfileFromClaims(claims);
      const tracker = normalizeTrackerInput(parseJsonBody(event));
      const saved = await putTracker(claims.sub, tracker);
      return json(201, { tracker: publicTracker(saved) });
    }

    if (request.routeKey === 'DELETE /trackers/{trackerId}') {
      const trackerId = decodeURIComponent(event.pathParameters?.trackerId || '');
      if (!trackerId) return json(400, { error: 'Missing tracker ID.' });
      await deleteTracker(claims.sub, trackerId);
      return { statusCode: 204, headers: { 'cache-control': 'no-store' }, body: '' };
    }

    return json(404, { error: 'Route not found.' });
  } catch (error) {
    console.error('API request failed', {
      routeKey: request.routeKey,
      message: error.message
    });
    const clientError = /Missing required field|unsupported characters|only digits|valid JSON|JSON object/.test(error.message);
    return json(clientError ? 400 : 500, {
      error: clientError ? error.message : 'The CourseSnag service could not complete this request.'
    });
  }
}
