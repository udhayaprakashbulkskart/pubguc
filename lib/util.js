'use strict';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Lets async route handlers throw into Express's error middleware.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const str = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const pwd = (value) => (typeof value === 'string' ? value : '');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PUBG_ID_RE = /^\d{6,15}$/;
const PHONE_RE = /^\+?[\d\s-]{6,20}$/;

module.exports = { HttpError, wrap, str, pwd, EMAIL_RE, PUBG_ID_RE, PHONE_RE };
