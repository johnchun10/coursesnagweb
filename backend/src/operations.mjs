import { sendAlertMessages } from './queue.mjs';
import { listDiscordProfiles } from './storage.mjs';

export async function handler(event = {}) {
  if (event.action !== 'announce-season-shutdown') {
    throw new Error('Unsupported owner operation.');
  }

  const profiles = await listDiscordProfiles();
  const messages = profiles.map(profile => ({
    type: 'season-shutdown',
    discordUserId: profile.discordUserId
  }));
  const queued = messages.length ? await sendAlertMessages(messages) : 0;
  return { eligibleUsers: profiles.length, queued };
}
