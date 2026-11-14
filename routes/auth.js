'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { query, one } = require('../lib/db');
const { HttpError, wrap, str, pwd, EMAIL_RE, PUBG_ID_RE, PHONE_RE } = require('../lib/util');
const {
  getUserById,
  publicUser,
  setSession,
  clearSession,
  currentUser,
  requireAuth,
  authLimiter,
} = require('../lib/auth');

const router = express.Router();
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12); // equalises login timing
const UNIQUE_VIOLATION = '23505';

const validatePassword = (password) => {
  if (password.length < 8 || password.length > 128) {
    throw new HttpError(400, 'Password must be 8–128 characters.');
  }
};

router.post(
  '/auth/signup',
  authLimiter,
  wrap(async (req, res) => {
    const name = str(req.body.name, 60);
    const email = str(req.body.email, 254).toLowerCase();
    const password = pwd(req.body.password);
    const phone = str(req.body.phone, 20);
    const pubgId = str(req.body.pubg_id, 15);

    if (name.length < 2) throw new HttpError(400, 'Name must be at least 2 characters.');
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Please enter a valid email address.');
    validatePassword(password);
    if (phone && !PHONE_RE.test(phone)) throw new HttpError(400, 'Please enter a valid phone number.');
    if (pubgId && !PUBG_ID_RE.test(pubgId)) throw new HttpError(400, 'Player ID must be 6–15 digits.');

    const hash = await bcrypt.hash(password, 12);
    let created;
    try {
      created = await one(
        'INSERT INTO users (name, email, password_hash, phone, pubg_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [name, email, hash, phone, pubgId]
      );
    } catch (err) {
      if (err.code === UNIQUE_VIOLATION) throw new HttpError(409, 'An account with this email already exists.');
      throw err;
    }

    setSession(res, created.id);
    res.status(201).json({ user: publicUser(await getUserById(created.id)) });
  })
);

router.post(
  '/auth/login',
  authLimiter,
  wrap(async (req, res) => {
    const email = str(req.body.email, 254).toLowerCase();
    const password = pwd(req.body.password);
    const row = await one('SELECT * FROM users WHERE email = $1', [email]);
    const ok = await bcrypt.compare(password, row ? row.password_hash : DUMMY_HASH);
    if (!row || !ok) throw new HttpError(401, 'Incorrect email or password.');

    setSession(res, row.id);
    res.json({ user: publicUser(row) });
  })
);

router.post('/auth/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get(
  '/auth/me',
  wrap(async (req, res) => {
    const user = await currentUser(req);
    res.json({ user: user ? publicUser(user) : null });
  })
);

router.put(
  '/profile',
  requireAuth,
  wrap(async (req, res) => {
    const name = str(req.body.name, 60);
    const phone = str(req.body.phone, 20);
    const pubgId = str(req.body.pubg_id, 15);

    if (name.length < 2) throw new HttpError(400, 'Name must be at least 2 characters.');
    if (phone && !PHONE_RE.test(phone)) throw new HttpError(400, 'Please enter a valid phone number.');
    if (pubgId && !PUBG_ID_RE.test(pubgId)) throw new HttpError(400, 'Player ID must be 6–15 digits.');

    await query('UPDATE users SET name = $1, phone = $2, pubg_id = $3 WHERE id = $4', [name, phone, pubgId, req.user.id]);
    res.json({ user: publicUser(await getUserById(req.user.id)) });
  })
);

router.put(
  '/profile/password',
  requireAuth,
  authLimiter,
  wrap(async (req, res) => {
    const current = pwd(req.body.current_password);
    const next = pwd(req.body.new_password);

    const row = await getUserById(req.user.id);
    if (!(await bcrypt.compare(current, row.password_hash))) {
      throw new HttpError(400, 'Your current password is incorrect.');
    }
    validatePassword(next);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(next, 12), req.user.id]);
    res.json({ ok: true });
  })
);

module.exports = router;
