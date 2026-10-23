import { randomBytes, timingSafeEqual } from 'node:crypto';

const adminKey = process.env.ADMIN_KEY || '';
const json = (res, status, value, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
};
const fail = (res, status, message) => json(res, status, { error: message });
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const validId = value => /^[1-9]\d*$/.test(String(value)) ? Number(value) : null;
const clean = (value, max) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max + 1) : '';

function voter(req, res) {
  const value = /(?:^|;\s*)opynyn_id=([a-f0-9]{48})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  if (value) return value;
  const id = randomBytes(24).toString('hex');
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `opynyn_id=${id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
  return id;
}

function isAdmin(req) {
  if (adminKey.length < 24) return false;
  const supplied = req.headers['x-admin-key'];
  if (typeof supplied !== 'string') return false;
  const a = Buffer.from(supplied), b = Buffer.from(adminKey);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function body(req) {
  let data = '';
  for await (const part of req) {
    data += part;
    if (data.length > 16384) throw new Error('Request too large');
  }
  try { return JSON.parse(data || '{}'); } catch { throw new Error('Invalid JSON'); }
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

export { adminKey, json, fail, escapeHtml, validId, clean, voter, isAdmin, body, sameOrigin };
