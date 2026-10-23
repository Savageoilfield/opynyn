import { db, today } from './db.mjs';
import { body, clean, fail, json, validId } from './http-utils.mjs';
import { changePassword, currentAdmin, endSession, startSession, verifyLogin } from './admin-auth.mjs';

const failedLogins = new Map();
const windowMs = 15 * 60 * 1000;

async function handleAdmin(req, res, path) {
  if (!path.startsWith('/api/admin/')) return false;
  if (req.method === 'POST' && path === '/api/admin/login') {
    const client = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    for (const [address, entry] of failedLogins) if (entry.until <= now) failedLogins.delete(address);
    if (failedLogins.size > 1000) failedLogins.clear();
    const attempts = failedLogins.get(client) || { count:0, until:now + windowMs };
    if (attempts.count >= 5 && attempts.until > now) return fail(res, 429, 'Too many attempts. Try again later.');
    const input = await body(req);
    const admin = verifyLogin(input.username, input.password);
    if (!admin) {
      failedLogins.set(client, { count:attempts.count + 1, until:attempts.until });
      return fail(res, 401, 'Invalid username or password');
    }
    failedLogins.delete(client);
    startSession(req, res, admin);
    json(res, 200, { username:admin.username, mustChangePassword:Boolean(admin.must_change_password) });
    return true;
  }

  const admin = currentAdmin(req);
  if (!admin) { fail(res, 401, 'Sign in to continue'); return true; }
  if (req.method === 'GET' && path === '/api/admin/me') {
    json(res, 200, { username:admin.username, mustChangePassword:Boolean(admin.mustChangePassword) });
    return true;
  }
  if (req.method === 'POST' && path === '/api/admin/logout') {
    endSession(req, res);
    json(res, 200, { ok:true });
    return true;
  }
  if (req.method === 'POST' && path === '/api/admin/password') {
    const input = await body(req);
    if (input.newPassword !== input.confirmPassword) {
      fail(res, 400, 'The new passwords do not match');
      return true;
    }
    if (!changePassword(req, res, admin, input.currentPassword, input.newPassword)) {
      fail(res, 400, 'Check your current password and use a new password of at least 12 characters');
    } else json(res, 200, { ok:true });
    return true;
  }
  if (admin.mustChangePassword) { fail(res, 403, 'Change your temporary password first'); return true; }

  if (req.method === 'GET' && path === '/api/admin/stats') {
    const count = table => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
    const queued = db.prepare('SELECT count(*) AS n FROM questions WHERE id NOT IN (SELECT question_id FROM editions)').get().n;
    const todayVotes = db.prepare(`SELECT count(*) AS n FROM votes v JOIN editions e ON e.question_id=v.question_id WHERE e.day=?`).get(today()).n;
    json(res, 200, { published:count('editions'), queued, votes:count('votes'), todayVotes, comments:count('comments') });
    return true;
  }
  if (req.method === 'GET' && path === '/api/admin/questions') {
    const questions = db.prepare(`SELECT q.*, e.day AS publishedDay FROM questions q LEFT JOIN editions e ON e.question_id=q.id ORDER BY q.id DESC`).all();
    json(res, 200, { questions });
    return true;
  }
  if (req.method === 'POST' && path === '/api/admin/questions') {
    const input = await body(req);
    const prompt = clean(input.prompt, 240), a = clean(input.optionA, 80), b = clean(input.optionB, 80);
    const date = input.scheduledDate || null;
    if (prompt.length < 10 || prompt.length > 240 || !a || a.length > 80 || !b || b.length > 80 ||
      (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
      fail(res, 400, 'Enter a question and two short choices'); return true;
    }
    if (date && db.prepare('SELECT id FROM questions WHERE scheduled_date=?').get(date)) {
      fail(res, 409, 'That date already has a scheduled question'); return true;
    }
    const result = db.prepare('INSERT INTO questions(prompt,option_a,option_b,scheduled_date) VALUES(?,?,?,?)').run(prompt,a,b,date);
    json(res, 201, { id:Number(result.lastInsertRowid) });
    return true;
  }
  const removeQ = /^\/api\/admin\/questions\/(\d+)$/.exec(path);
  if (req.method === 'DELETE' && removeQ) {
    const result = db.prepare('DELETE FROM questions WHERE id=? AND id NOT IN (SELECT question_id FROM editions)').run(validId(removeQ[1]));
    result.changes ? json(res, 200, { ok:true }) : fail(res, 409, 'Only unpublished questions can be removed');
    return true;
  }
  if (req.method === 'GET' && path === '/api/admin/comments') {
    const comments = db.prepare(`SELECT c.id,c.name,c.body,c.created_at AS createdAt,q.prompt
      FROM comments c JOIN questions q ON q.id=c.question_id ORDER BY c.id DESC LIMIT 100`).all();
    json(res, 200, { comments });
    return true;
  }
  const removeC = /^\/api\/admin\/comments\/(\d+)$/.exec(path);
  if (req.method === 'DELETE' && removeC) {
    const result = db.prepare('DELETE FROM comments WHERE id=?').run(validId(removeC[1]));
    result.changes ? json(res, 200, { ok:true }) : fail(res, 404, 'Comment not found');
    return true;
  }
  fail(res, 404, 'Not found');
  return true;
}

export { handleAdmin };
