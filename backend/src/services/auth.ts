import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getDatabase } from './database';
import { config } from '../config/env';

export interface AuthUser { id: string; name: string; email: string; role: 'member' | 'circle_head' }
declare global { namespace Express { interface Request { authUser?: AuthUser } } }

const SESSION_COOKIE = 'circlecred_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function makePasswordHash(password: string): string {
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${digest.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [saltHex, digestHex] = stored.split(':');
  if (!saltHex || !digestHex) return false;
  const expected = Buffer.from(digestHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const db = getDatabase();
  db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(new Date().toISOString());
  db.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(tokenHash,userId,expiresAt);
  return { token, tokenHash, expiresAt };
}

export function setSessionCookie(res: Response, token: string) {
  const secure = config.nodeEnv === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
}

export function clearSessionCookie(res: Response) {
  const secure = config.nodeEnv === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}

function requestToken(req: Request): string | undefined {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return undefined;
  const pair = cookieHeader.split(';').map(piece => piece.trim()).find(piece => piece.startsWith(`${SESSION_COOKIE}=`));
  return pair?.slice(SESSION_COOKIE.length + 1);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = requestToken(req);
  if (!token) return res.status(401).json({ error: 'Sign in to access this resource.' });
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const user = getDatabase().prepare(`SELECT u.id,u.name,u.email,u.role FROM auth_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`).get(tokenHash,new Date().toISOString()) as AuthUser | undefined;
  if (!user) return res.status(401).json({ error: 'Your session is invalid or expired. Sign in again.' });
  req.authUser = user;
  return next();
}

export function requireRole(role: AuthUser['role']) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.authUser) return res.status(401).json({ error: 'Sign in to access this resource.' });
    if (req.authUser.role !== role) return res.status(403).json({ error: 'Your role does not allow this action.' });
    return next();
  };
}

export function requireManagedCircle(req: Request, res: Response, next: NextFunction) {
  const circleId = String(req.params.circleId || req.params.id || '');
  const manager = req.authUser;
  if (!manager || manager.role !== 'circle_head') return res.status(403).json({ error: 'Circle head access is required.' });
  const allowed = getDatabase().prepare('SELECT 1 FROM circle_heads WHERE user_id=? AND circle_id=?').get(manager.id,circleId);
  if (!allowed) return res.status(404).json({ error: 'Managed circle not found.' });
  return next();
}

export function cookieName() { return SESSION_COOKIE; }
