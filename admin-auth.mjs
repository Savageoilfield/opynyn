import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db.mjs';

const sessionSeconds = 12 * 60 * 60;
const cookieName = 'opynyn_admin';
const digest = value => createHash('sha256').update(value).digest('hex');
const hashPassword = (password, salt) => scryptSync(password, Buffer.from(salt, 'hex'), 64);
const validPassword = password => typeof password === 'string' && password.length >= 12 && password.length <= 128;

function createFirstAdmin(username, password) {
  if (db.prepare('SELECT count(*) AS n FROM admins').get().n) throw new Error('An admin account already exists');
  if (!/^[a-z][a-z0-9_-]{2,31}$/.test(username) || !validPassword(password)) throw new Error('Invalid username or password');
  const salt = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO admins(username,password_salt,password_hash) VALUES(?,?,?)')
    .run(username, salt, hashPassword(password, salt).toString('hex'));
}

function verifyLogin(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string' || password.length > 128) return null;
  const admin = db.prepare('SELECT * FROM admins WHERE username=?').get(username.trim().toLowerCase());
  const salt = admin?.password_salt || '00'.repeat(32);
  const expected = Buffer.from(admin?.password_hash || '00'.repeat(64), 'hex');
  const actual = hashPassword(password, salt);
  return admin && timingSafeEqual(actual, expected) ? admin : null;
}

function sessionCookie(req, token, maxAge) {
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
  return `${cookieName}=${token}; Path=/api/admin; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

function startSession(req, res, admin) {
  const token = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').run(Date.now());
  db.prepare('INSERT INTO admin_sessions(token_hash,admin_id,expires_at) VALUES(?,?,?)')
    .run(digest(token), admin.id, Date.now() + sessionSeconds * 1000);
  res.setHeader('Set-Cookie', sessionCookie(req, token, sessionSeconds));
}

function sessionToken(req) {
  return /(?:^|;\s*)opynyn_admin=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
}

function currentAdmin(req) {
  const token = sessionToken(req);
  if (!token) return null;
  return db.prepare(`SELECT a.id,a.username,a.must_change_password AS mustChangePassword
    FROM admin_sessions s JOIN admins a ON a.id=s.admin_id
    WHERE s.token_hash=? AND s.expires_at>?`).get(digest(token), Date.now()) || null;
}

function endSession(req, res) {
  const token = sessionToken(req);
  if (token) db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(digest(token));
  res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
}

function changePassword(req, res, admin, currentPassword, nextPassword) {
  if (!validPassword(nextPassword) || currentPassword === nextPassword) return false;
  if (!verifyLogin(admin.username, currentPassword)) return false;
  const salt = randomBytes(32).toString('hex');
  db.prepare('UPDATE admins SET password_salt=?,password_hash=?,must_change_password=0 WHERE id=?')
    .run(salt, hashPassword(nextPassword, salt).toString('hex'), admin.id);
  db.prepare('DELETE FROM admin_sessions WHERE admin_id=?').run(admin.id);
  startSession(req, res, admin);
  return true;
}

export { createFirstAdmin, verifyLogin, startSession, currentAdmin, endSession, changePassword };
