import { createPublicKey, verify } from 'node:crypto';
import { config, requireConfig } from './config.mjs';
import { currentMode } from './mode.mjs';
import {
  acquireCommandRateLimit,
  getProfile,
  listTrackers,
  markUserActive
} from './storage.mjs';

const EPHEMERAL_MESSAGE_FLAG = 1 << 6;
const TRACKED_COMMAND_COOLDOWN_SECONDS = 10;
const SIGNATURE_MAX_AGE_SECONDS = 5 * 60;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

function headerValue(headers, name) {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === target) return value;
  }
  return '';
}

function rawRequestBody(event) {
  if (!event?.body) return '';
  return event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
}

export function verifyInteractionSignature({
  body,
  signature,
  timestamp,
  publicKey,
  nowSeconds = Math.floor(Date.now() / 1000)
}) {
  if (!/^[a-f0-9]{128}$/i.test(signature || '')) return false;
  if (!/^[a-f0-9]{64}$/i.test(publicKey || '')) return false;
  const signedAt = Number(timestamp);
  if (!Number.isFinite(signedAt) || Math.abs(nowSeconds - signedAt) > SIGNATURE_MAX_AGE_SECONDS) {
    return false;
  }

  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey, 'hex')]),
      format: 'der',
      type: 'spki'
    });
    return verify(
      null,
      Buffer.from(`${timestamp}${body}`, 'utf8'),
      key,
      Buffer.from(signature, 'hex')
    );
  } catch {
    return false;
  }
}

function safeText(value, maxLength = 160) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/([\\`*_{}\[\]()#+\-.!|>~])/g, '\\$1')
    .trim()
    .slice(0, maxLength);
}

function statusLabel(status) {
  if (status === 'O') return 'OPEN';
  if (status === 'W') return 'WAITLISTED';
  if (status === 'C') return 'CLOSED';
  return 'AWAITING CHECK';
}

export function trackedCoursesContent(trackers) {
  if (!trackers.length) return '**Tracked courses (0)**\nYour cloud watchlist is empty.';

  const ordered = [...trackers].sort((left, right) => [
    left.roster,
    left.subject,
    left.catalogNbr,
    left.section,
    left.classNbr
  ].join('|').localeCompare([
    right.roster,
    right.subject,
    right.catalogNbr,
    right.section,
    right.classNbr
  ].join('|')));

  const lines = [`**Tracked courses (${ordered.length})**`];
  let included = 0;
  for (const tracker of ordered) {
    const course = safeText(`${tracker.subject || ''} ${tracker.catalogNbr || ''}`.trim() || 'Course');
    const details = [
      tracker.section ? `Section ${safeText(tracker.section, 40)}` : '',
      safeText(tracker.roster, 40),
      statusLabel(tracker.lastStatus)
    ].filter(Boolean).join(' · ');
    const title = tracker.title ? ` — ${safeText(tracker.title, 120)}` : '';
    const line = `• **${course}**${title}\n  ${details}`;
    if ([...lines, line].join('\n').length > 1_850) break;
    lines.push(line);
    included += 1;
  }

  if (included < ordered.length) {
    lines.push(`_Showing ${included} of ${ordered.length} tracked courses._`);
  }
  return lines.join('\n');
}

export function unlinkedAccountPrompt() {
  return {
    content: '**CourseSnag is not linked to this Discord account yet.**\nConnect Discord through the CourseSnag setup, then run `/tracked` again.',
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 5,
        label: 'Set up CourseSnag',
        url: 'https://coursesnag.pages.dev/?setup=discord'
      }]
    }]
  };
}

export function unavailableCommandContent() {
  return 'This CourseSnag command is currently unavailable.';
}

function ephemeral(content, components = []) {
  return response(200, {
    type: 4,
    data: {
      content,
      flags: EPHEMERAL_MESSAGE_FLAG,
      allowed_mentions: { parse: [] },
      components
    }
  });
}

export async function handler(event) {
  const body = rawRequestBody(event);
  const signature = headerValue(event?.headers, 'x-signature-ed25519');
  const timestamp = headerValue(event?.headers, 'x-signature-timestamp');
  requireConfig('discordPublicKey');

  if (!verifyInteractionSignature({
    body,
    signature,
    timestamp,
    publicKey: config.discordPublicKey
  })) {
    return response(401, { error: 'Invalid request signature.' });
  }

  let interaction;
  try {
    interaction = JSON.parse(body);
  } catch {
    return response(400, { error: 'Invalid interaction payload.' });
  }

  if (interaction.type === 1) return response(200, { type: 1 });
  if (interaction.type !== 2 || interaction.data?.name !== 'tracked') {
    return ephemeral('That CourseSnag command is not supported.');
  }

  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!/^\d+$/.test(userId || '')) return ephemeral('Discord user information was unavailable.');

  try {
    const mode = await currentMode();
    if (mode !== 'cloud') return ephemeral(unavailableCommandContent());

    const allowed = await acquireCommandRateLimit(
      userId,
      'tracked',
      TRACKED_COMMAND_COOLDOWN_SECONDS
    );
    if (!allowed) {
      return ephemeral(`Please wait ${TRACKED_COMMAND_COOLDOWN_SECONDS} seconds before using \`/tracked\` again.`);
    }

    const profile = await getProfile(userId);
    if (!profile?.discordUserId) {
      const prompt = unlinkedAccountPrompt();
      return ephemeral(prompt.content, prompt.components);
    }

    await markUserActive(userId);
    const trackers = await listTrackers(userId);
    return ephemeral(trackedCoursesContent(trackers));
  } catch (error) {
    console.error('Discord interaction failed', {
      command: interaction.data?.name,
      userId,
      message: error.message
    });
    return ephemeral('CourseSnag could not load your cloud watchlist. Try again shortly.');
  }
}
