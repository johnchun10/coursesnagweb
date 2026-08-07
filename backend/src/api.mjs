import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { config, requireConfig } from './config.mjs';
import { normalizeTrackerInput, publicTracker } from './domain.mjs';
import { json, parseJsonBody, route, userClaims } from './http.mjs';
import {
  deleteTracker,
  getProfile,
  listTrackers,
  putTracker,
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
  return {
    email: profile.googleEmail || '',
    name: profile.googleName || '',
    picture: profile.googlePicture || '',
    discordConnected: Boolean(profile.discordUserId),
    updatedAt: profile.updatedAt || null
  };
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

    const claims = userClaims(event);

    if (request.routeKey === 'GET /me') {
      return json(200, { profile: publicProfile(await getProfile(claims.sub)) });
    }

    if (request.routeKey === 'PUT /me') {
      return json(200, { profile: publicProfile(await upsertProfileFromClaims(claims)) });
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
