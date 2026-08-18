import { sendDirectMessage } from './discord.mjs';
import { currentMode } from './mode.mjs';

const COURSE_NOTIFICATION_TYPES = new Set(['course-opened', 'course-not-open']);

export function shouldDeliverNotification(message, mode) {
  return !COURSE_NOTIFICATION_TYPES.has(message?.type) || mode === 'cloud';
}

export async function handler(event) {
  const batchItemFailures = [];
  let mode;
  for (const record of event.Records || []) {
    try {
      const message = JSON.parse(record.body);
      if (message.type === 'season-offline') mode = 'stopping';
      if (message.type === 'season-online') mode = 'cloud';
      if (COURSE_NOTIFICATION_TYPES.has(message.type)) {
        mode ??= await currentMode();
        if (!shouldDeliverNotification(message, mode)) {
          console.log('Course notification suppressed while Discord monitoring is paused', {
            messageId: record.messageId,
            type: message.type
          });
          continue;
        }
      }
      await sendDirectMessage(message);
      console.log('Discord notification accepted', {
        messageId: record.messageId,
        eventId: message.eventId || null,
        type: message.type,
        sourceObservedAt: message.sourceObservedAt || null,
        detectedAt: message.detectedAt || null,
        queuedAt: message.queuedAt || null,
        providerAcceptedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Discord notification failed', {
        messageId: record.messageId,
        message: error.message
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
