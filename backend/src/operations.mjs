import { sendAlertMessages } from './queue.mjs';
import { listDiscordProfiles } from './storage.mjs';

const notificationTypeByAction = {
  'announce-season-offline': 'season-offline',
  'announce-season-online': 'season-online'
};

export async function handler(event = {}) {
  const notificationType = notificationTypeByAction[event.action];
  if (!notificationType) {
    throw new Error('Unsupported owner operation.');
  }

  const profiles = await listDiscordProfiles();
  const messages = profiles.map(profile => ({
    type: notificationType,
    discordUserId: profile.discordUserId
  }));
  const queued = messages.length ? await sendAlertMessages(messages) : 0;
  return { eligibleUsers: profiles.length, queued };
}
