import { createHash, randomBytes } from 'node:crypto';
import {
  consumeLoginCode,
  deleteSession,
  getSession,
  putLoginCode,
  putSession
} from './storage.mjs';

const LOGIN_CODE_LIFETIME_SECONDS = 2 * 60;
const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

export function secretHash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function bearerToken(event) {
  const value = event?.headers?.authorization || event?.headers?.Authorization || '';
  const match = /^Bearer\s+([A-Za-z0-9_-]{32,})$/i.exec(value.trim());
  return match?.[1] || '';
}

export async function createLoginCode(userId) {
  const code = randomBytes(32).toString('base64url');
  await putLoginCode(userId, secretHash(code), LOGIN_CODE_LIFETIME_SECONDS);
  return code;
}

export async function exchangeLoginCode(code) {
  if (!/^[A-Za-z0-9_-]{32,}$/.test(String(code || ''))) {
    throw new Error('Discord login code is invalid.');
  }
  const pending = await consumeLoginCode(secretHash(code));
  if (!pending?.userId) throw new Error('Discord login expired or was already used.');

  const sessionToken = randomBytes(32).toString('base64url');
  const expiresAt = await putSession(
    pending.userId,
    secretHash(sessionToken),
    SESSION_LIFETIME_SECONDS
  );
  return { userId: pending.userId, sessionToken, expiresAt };
}

export async function authenticateSession(event) {
  const token = bearerToken(event);
  if (!token) return null;
  const tokenHash = secretHash(token);
  const session = await getSession(tokenHash);
  if (!session?.userId) return null;
  return { userId: session.userId, tokenHash, expiresAt: session.expiresAt };
}

export async function revokeSession(tokenHash) {
  if (tokenHash) await deleteSession(tokenHash);
}
