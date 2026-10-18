import jwt from 'jsonwebtoken';
import db from '../db/index.js';
import { HttpError } from './errorHandler.js';

const COOKIE_NAME = 'sw_session';

export function signToken(user) {
  return jwt.sign({ sub: user.id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

export function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

const getUserById = db.prepare(
  'SELECT id, name, email, upi_vpa FROM users WHERE id = ?'
);

export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) throw new HttpError(401, 'Not signed in');
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = getUserById.get(payload.sub);
    if (!user) throw new HttpError(401, 'Not signed in');
    req.user = user;
    next();
  } catch {
    throw new HttpError(401, 'Not signed in');
  }
}

// Confirms req.user is a member of :groupId and attaches req.membership.
const getMembership = db.prepare(
  'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?'
);

export function requireGroupMember(req, res, next) {
  const groupId = Number(req.params.groupId);
  const membership = getMembership.get(groupId, req.user.id);
  if (!membership) throw new HttpError(403, 'Not a member of this group');
  req.groupId = groupId;
  req.membership = membership;
  next();
}
