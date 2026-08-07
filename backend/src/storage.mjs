import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand
} from '@aws-sdk/lib-dynamodb';
import { config, requireConfig } from './config.mjs';

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

const userPk = userId => `USER#${userId}`;
const profileKey = userId => ({ PK: userPk(userId), SK: 'PROFILE' });

export async function upsertProfileFromClaims(claims) {
  requireConfig('tableName');
  const now = new Date().toISOString();
  await documentClient.send(new UpdateCommand({
    TableName: config.tableName,
    Key: profileKey(claims.sub),
    UpdateExpression: [
      'SET entityType = :profile',
      'googleEmail = :email',
      'googleName = :name',
      'googlePicture = :picture',
      'updatedAt = :now',
      'createdAt = if_not_exists(createdAt, :now)'
    ].join(', '),
    ExpressionAttributeValues: {
      ':profile': 'profile',
      ':email': claims.email || '',
      ':name': claims.name || '',
      ':picture': claims.picture || '',
      ':now': now
    }
  }));
  return getProfile(claims.sub);
}

export async function getProfile(userId) {
  requireConfig('tableName');
  const result = await documentClient.send(new GetCommand({
    TableName: config.tableName,
    Key: profileKey(userId),
    ConsistentRead: true
  }));
  return result.Item || null;
}

export async function putDiscordOAuthState(userId, state, lifetimeSeconds) {
  requireConfig('tableName');
  const nowSeconds = Math.floor(Date.now() / 1000);
  await documentClient.send(new PutCommand({
    TableName: config.tableName,
    Item: {
      PK: `OAUTH#${state}`,
      SK: 'DISCORD',
      entityType: 'oauthState',
      userId,
      createdAt: new Date(nowSeconds * 1000).toISOString(),
      expiresAt: nowSeconds + lifetimeSeconds
    },
    ConditionExpression: 'attribute_not_exists(PK)'
  }));
}

export async function consumeDiscordOAuthState(state) {
  requireConfig('tableName');
  if (!state) return null;
  const result = await documentClient.send(new DeleteCommand({
    TableName: config.tableName,
    Key: { PK: `OAUTH#${state}`, SK: 'DISCORD' },
    ReturnValues: 'ALL_OLD'
  }));
  const item = result.Attributes;
  if (!item || Number(item.expiresAt || 0) <= Math.floor(Date.now() / 1000)) return null;
  return item;
}

export async function upsertDiscordConnection(userId, discord) {
  requireConfig('tableName');
  const now = new Date().toISOString();
  const result = await documentClient.send(new UpdateCommand({
    TableName: config.tableName,
    Key: profileKey(userId),
    UpdateExpression: [
      'SET discordUserId = :discordUserId',
      'discordUsername = :discordUsername',
      'discordDisplayName = :discordDisplayName',
      'discordAvatar = :discordAvatar',
      'discordConnectedAt = :now',
      'updatedAt = :now'
    ].join(', '),
    ExpressionAttributeValues: {
      ':discordUserId': discord.userId,
      ':discordUsername': discord.username,
      ':discordDisplayName': discord.displayName,
      ':discordAvatar': discord.avatar,
      ':now': now
    },
    ConditionExpression: 'attribute_exists(PK)',
    ReturnValues: 'ALL_NEW'
  }));
  return result.Attributes;
}

export async function deleteDiscordConnection(userId) {
  requireConfig('tableName');
  const now = new Date().toISOString();
  const result = await documentClient.send(new UpdateCommand({
    TableName: config.tableName,
    Key: profileKey(userId),
    UpdateExpression: [
      'SET updatedAt = :now',
      'REMOVE discordUserId, discordUsername, discordDisplayName, discordAvatar, discordConnectedAt'
    ].join(' '),
    ExpressionAttributeValues: { ':now': now },
    ReturnValues: 'ALL_NEW'
  }));
  return result.Attributes;
}

export async function listTrackers(userId) {
  requireConfig('tableName');
  const result = await documentClient.send(new QueryCommand({
    TableName: config.tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': userPk(userId),
      ':prefix': 'TRACKER#'
    }
  }));
  return result.Items || [];
}

export async function putTracker(userId, tracker) {
  requireConfig('tableName');
  const now = new Date().toISOString();
  const result = await documentClient.send(new UpdateCommand({
    TableName: config.tableName,
    Key: {
      PK: userPk(userId),
      SK: `TRACKER#${tracker.trackerId}`
    },
    UpdateExpression: [
      'SET GSI1PK = :active',
      'GSI1SK = :activeSort',
      'entityType = :trackerType',
      'userId = :userId',
      'roster = :roster',
      'subject = :subject',
      'classNbr = :classNbr',
      'trackerId = :trackerId',
      'catalogNbr = :catalogNbr',
      'title = :title',
      'section = :section',
      'ssrComponent = :ssrComponent',
      'classTime = :classTime',
      'enabled = :enabled',
      'lastStatus = if_not_exists(lastStatus, :unknown)',
      'createdAt = if_not_exists(createdAt, :now)',
      'updatedAt = :now'
    ].join(', '),
    ExpressionAttributeValues: {
      ':active': 'ACTIVE',
      ':activeSort': `${tracker.roster}#${tracker.subject}#${tracker.classNbr}#${userId}`,
      ':trackerType': 'tracker',
      ':userId': userId,
      ':roster': tracker.roster,
      ':subject': tracker.subject,
      ':classNbr': tracker.classNbr,
      ':trackerId': tracker.trackerId,
      ':catalogNbr': tracker.catalogNbr,
      ':title': tracker.title,
      ':section': tracker.section,
      ':ssrComponent': tracker.ssrComponent,
      ':classTime': tracker.classTime,
      ':enabled': true,
      ':unknown': 'UNKNOWN',
      ':now': now
    },
    ReturnValues: 'ALL_NEW'
  }));
  return result.Attributes;
}

export async function deleteTracker(userId, trackerId) {
  requireConfig('tableName');
  await documentClient.send(new DeleteCommand({
    TableName: config.tableName,
    Key: {
      PK: userPk(userId),
      SK: `TRACKER#${trackerId}`
    }
  }));
}

export async function listAllActiveTrackers() {
  requireConfig('tableName');
  const items = [];
  let ExclusiveStartKey;
  do {
    const result = await documentClient.send(new QueryCommand({
      TableName: config.tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :active',
      ExpressionAttributeValues: { ':active': 'ACTIVE' },
      ExclusiveStartKey
    }));
    items.push(...(result.Items || []));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

export async function updateTrackerStatus(tracker, newStatus, checkedAt) {
  requireConfig('tableName');
  await documentClient.send(new UpdateCommand({
    TableName: config.tableName,
    Key: { PK: tracker.PK, SK: tracker.SK },
    UpdateExpression: 'SET lastStatus = :status, lastCheckedAt = :checked, updatedAt = :checked',
    ExpressionAttributeValues: {
      ':status': newStatus,
      ':checked': checkedAt
    }
  }));
}

export async function getProfiles(userIds) {
  requireConfig('tableName');
  const uniqueIds = [...new Set(userIds)];
  const profiles = new Map();
  for (let index = 0; index < uniqueIds.length; index += 100) {
    const ids = uniqueIds.slice(index, index + 100);
    const result = await documentClient.send(new BatchGetCommand({
      RequestItems: {
        [config.tableName]: {
          Keys: ids.map(profileKey)
        }
      }
    }));
    for (const item of result.Responses?.[config.tableName] || []) {
      profiles.set(item.PK.slice('USER#'.length), item);
    }
  }
  return profiles;
}

export async function listDiscordProfiles() {
  requireConfig('tableName');
  const profiles = [];
  let ExclusiveStartKey;
  do {
    const result = await documentClient.send(new ScanCommand({
      TableName: config.tableName,
      FilterExpression: 'SK = :profile AND attribute_exists(discordUserId)',
      ExpressionAttributeValues: { ':profile': 'PROFILE' },
      ExclusiveStartKey
    }));
    profiles.push(...(result.Items || []));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return profiles;
}
