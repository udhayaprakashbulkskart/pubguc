'use strict';

const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { one } = require('./db');
const { IS_PROD, JWT_SECRET } = require('./config');
const { HttpError } = require('./util');

const COOKIE_NAME = 'uc_session';
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: IS_PROD,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

const getUserById = (id) => one('SELECT * FROM users WHERE id = $1', [id]);

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    pubg_id: row.pubg_id,
    balance_cents: row.balance_cents,
    created_at: row.created_at,
  };
}

function setSession(res, userId) {
  const token = jwt.sign({ uid: userId }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
}

function clearSession(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

// Returns the user for a valid session cookie, or null. Database errors still propagate.
async function currentUser(req) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return null;

  let uid;
  try {
    ({ uid } = jwt.verify(token, JWT_SECRET));
  } catch (_) {
    return null;
  }
  return (await getUserById(uid)) || null;
}

async function requireAuth(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) return next(new HttpError(401, 'Please log in to continue.'));
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
});

module.exports = {
  COOKIE_NAME,
  getUserById,
  publicUser,
  setSession,
  clearSession,
  currentUser,
  requireAuth,
  authLimiter,
};
