import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { createHash } from 'node:crypto';
import { config, requireConfig } from './config.mjs';

const sqs = new SQSClient({});

export async function sendAlertMessages(messages) {
  requireConfig('alertQueueUrl');
  let sent = 0;
  for (let index = 0; index < messages.length; index += 10) {
    const batch = messages.slice(index, index + 10);
    const result = await sqs.send(new SendMessageBatchCommand({
      QueueUrl: config.alertQueueUrl,
      Entries: batch.map((message, batchIndex) => {
        const body = JSON.stringify(message);
        const stableAlertIdentity = message.type === 'course-opened'
          ? `${message.type}:${message.discordUserId}:${message.tracker?.roster}:${message.tracker?.classNbr}`
          : `${message.type}:${message.discordUserId}`;
        return {
          Id: String(batchIndex),
          MessageBody: body,
          MessageGroupId: String(message.discordUserId),
          MessageDeduplicationId: createHash('sha256').update(stableAlertIdentity).digest('hex')
        };
      })
    }));
    if (result.Failed?.length) {
      throw new Error(`Failed to queue ${result.Failed.length} Discord alert(s).`);
    }
    sent += result.Successful?.length || 0;
  }
  return sent;
}
