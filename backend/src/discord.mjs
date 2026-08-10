import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { config, requireConfig } from './config.mjs';

const ssm = new SSMClient({});
let cachedBotToken;

async function botToken() {
  if (cachedBotToken) return cachedBotToken;
  requireConfig('discordBotTokenParameter');
  const result = await ssm.send(new GetParameterCommand({
    Name: config.discordBotTokenParameter,
    WithDecryption: true
  }));
  if (!result.Parameter?.Value) throw new Error('Discord bot token is not configured.');
  cachedBotToken = result.Parameter.Value;
  return cachedBotToken;
}

async function discordRequest(path, body, attempt = 0) {
  const token = await botToken();
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bot ${token}`,
      'content-type': 'application/json',
      'user-agent': 'DiscordBot (https://coursesnag.pages.dev, 0.1)'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000)
  });

  if (response.status === 429 && attempt < 1) {
    const rateLimit = await response.json();
    const delayMs = Math.max(250, Math.ceil(Number(rateLimit.retry_after || 1) * 1_000));
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return discordRequest(path, body, attempt + 1);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord API returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return response.status === 204 ? null : response.json();
}

function trackerDetails(tracker) {
  return [
    tracker.title,
    tracker.section ? `Section ${tracker.section}` : '',
    tracker.classNbr ? `Class #${tracker.classNbr}` : '',
    tracker.classTime
  ].filter(Boolean).join(' • ');
}

function courseName(tracker) {
  return `${tracker.subject || ''} ${tracker.catalogNbr || ''}`.trim() || 'Course';
}

export function notificationContent(message) {
  if (message.type === 'season-shutdown') {
    return {
      content: 'CourseSnag cloud tracking is going to sleep for the off-season. Your saved browser watchlist can continue tracking locally whenever you keep CourseSnag open. Cloud tracking and Discord alerts will return before the next enrollment period.'
    };
  }

  if (message.type === 'connection-confirmed') {
    return {
      content: '✅ **CourseSnag is connected.**\nYour Discord account is ready for cloud watchlist sync and course alerts.\n\nOpen CourseSnag: https://coursesnag.pages.dev'
    };
  }

  const tracker = message.tracker || {};
  const course = courseName(tracker);
  const details = trackerDetails(tracker);
  const footer = '\n\nOpen CourseSnag: https://coursesnag.pages.dev';

  if (message.type === 'tracking-added') {
    return {
      content: `📌 **Now tracking ${course}**\n${details}\nI’ll message you when its availability changes.${footer}`
    };
  }

  if (message.type === 'tracking-removed') {
    return {
      content: `🗑️ **Stopped tracking ${course}**\n${details}${footer}`
    };
  }

  if (message.type === 'course-not-open') {
    const status = message.status === 'W' ? 'waitlisted' : 'not open';
    return {
      content: `🔒 **${course} is ${status}.**\n${details}${footer}`
    };
  }

  return {
    content: `🎉 **${course} is open!**\n${details}${footer}`
  };
}

export async function sendDirectMessage(message) {
  const channel = await discordRequest('/users/@me/channels', {
    recipient_id: message.discordUserId
  });
  return discordRequest(`/channels/${channel.id}/messages`, notificationContent(message));
}
