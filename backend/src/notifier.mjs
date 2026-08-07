import { sendDirectMessage } from './discord.mjs';

export async function handler(event) {
  const batchItemFailures = [];
  for (const record of event.Records || []) {
    try {
      const message = JSON.parse(record.body);
      await sendDirectMessage(message);
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
