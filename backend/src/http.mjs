const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

export function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { ...JSON_HEADERS, ...headers },
    body: JSON.stringify(body)
  };
}

export function redirect(location, statusCode = 302) {
  return {
    statusCode,
    headers: {
      'cache-control': 'no-store',
      location
    },
    body: ''
  };
}

export function parseJsonBody(event) {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    return JSON.parse(raw);
  } catch {
    throw new Error('Request body must be valid JSON.');
  }
}

export function route(event) {
  return {
    method: event?.requestContext?.http?.method || '',
    path: event?.rawPath || '',
    routeKey: event?.routeKey || ''
  };
}
