import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { db, ensureEdition, questionView, today, timezone } from './db.mjs';
import { adminKey, json, fail, escapeHtml, validId, clean, voter, isAdmin, body, sameOrigin } from './http-utils.mjs';

const publicDir = resolve('public');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

const assets = {
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/admin.js': ['admin.js', 'text/javascript; charset=utf-8']
};

async function handler(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  const path = url.pathname;
  if (req.method === 'GET' && (path === '/' || path === '/admin' || assets[path])) {
    if (assets[path]) {
      const [file, type] = assets[path];
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
      return res.end(readFileSync(join(publicDir, file)));
    }
    let html = readFileSync(join(publicDir, path === '/admin' ? 'admin.html' : 'index.html'), 'utf8');
    if (path === '/') {
      const current = ensureEdition();
      const requestedId = validId(url.searchParams.get('q'));
      const q = requestedId ? db.prepare(`SELECT q.* FROM editions e JOIN questions q ON q.id=e.question_id WHERE q.id=?`).get(requestedId) || current : current;
      const base = (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, '');
      html = html.replaceAll('{{TITLE}}', escapeHtml(q?.prompt || 'One question. Every perspective.'))
        .replaceAll('{{CANONICAL}}', escapeHtml(`${base}${q ? `/?q=${q.id}` : ''}`));
    }
    res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" });
    return res.end(html);
  }
  if (req.method === 'GET' && path === '/health') return json(res, 200, { ok:true });
  if (!path.startsWith('/api/')) return fail(res, 404, 'Not found');
  if (!['GET','POST','DELETE'].includes(req.method)) return fail(res, 405, 'Method not allowed');
  if (req.method !== 'GET' && (!sameOrigin(req) || !String(req.headers['content-type'] || '').startsWith('application/json'))) return fail(res, 403, 'Invalid request origin or content type');
  const voterId = voter(req, res);

  if (req.method === 'GET' && path === '/api/today') return json(res, 200, { question:questionView(ensureEdition(), voterId), timezone });
  if (req.method === 'GET' && path === '/api/archive') {
    const rows = db.prepare(`SELECT e.day, q.id, q.prompt, count(v.choice) AS votes
      FROM editions e JOIN questions q ON q.id=e.question_id LEFT JOIN votes v ON v.question_id=q.id
      GROUP BY e.day ORDER BY e.day DESC LIMIT 30`).all();
    return json(res, 200, { questions:rows });
  }
  const questionMatch = /^\/api\/questions\/(\d+)$/.exec(path);
  if (req.method === 'GET' && questionMatch) {
    const q = db.prepare(`SELECT q.*, e.day FROM editions e JOIN questions q ON q.id=e.question_id WHERE q.id=?`).get(validId(questionMatch[1]));
    return q ? json(res, 200, { question:questionView(q, voterId) }) : fail(res, 404, 'Question not found');
  }
  if (req.method === 'POST' && path === '/api/votes') {
    const input = await body(req);
    const id = validId(input.questionId), choice = input.choice;
    const q = id && db.prepare('SELECT day FROM editions WHERE question_id=?').get(id);
    if (!q || q.day !== today() || !['a','b'].includes(choice)) return fail(res, 400, 'Vote on today’s question with a valid choice');
    db.prepare('INSERT OR IGNORE INTO votes(question_id,voter_id,choice) VALUES(?,?,?)').run(id, voterId, choice);
    const row = db.prepare(`SELECT q.*, e.day FROM editions e JOIN questions q ON q.id=e.question_id WHERE q.id=?`).get(id);
    return json(res, 200, { question:questionView(row, voterId) });
  }
  const commentsMatch = /^\/api\/questions\/(\d+)\/comments$/.exec(path);
  if (commentsMatch) {
    const id = validId(commentsMatch[1]);
    const q = id && db.prepare('SELECT day FROM editions WHERE question_id=?').get(id);
    if (!q) return fail(res, 404, 'Question not found');
    if (req.method === 'GET') {
      const rows = db.prepare(`SELECT id,parent_id AS parentId,name,stance,body,created_at AS createdAt
        FROM comments WHERE question_id=? ORDER BY id ASC LIMIT 500`).all(id);
      return json(res, 200, { comments:rows });
    }
    if (req.method === 'POST') {
      if (q.day !== today()) return fail(res, 400, 'Discussion is closed for past questions');
      const input = await body(req);
      const name = clean(input.name, 32), message = clean(input.body, 1000);
      const stance = input.stance, parentId = input.parentId == null ? null : validId(input.parentId);
      if (!name || name.length > 32 || message.length < 3 || message.length > 1000 || !['a','b','unsure'].includes(stance)) return fail(res, 400, 'Enter a name, stance, and comment (3–1000 characters)');
      if (input.parentId != null && (!parentId || !db.prepare('SELECT id FROM comments WHERE id=? AND question_id=?').get(parentId, id))) return fail(res, 400, 'Invalid reply');
      const recent = db.prepare(`SELECT created_at FROM comments WHERE voter_id=? ORDER BY id DESC LIMIT 1`).get(voterId);
      if (recent && Date.now() - Date.parse(`${recent.created_at}Z`) < 30000) return fail(res, 429, 'Wait 30 seconds before posting again');
      db.prepare('INSERT INTO comments(question_id,parent_id,voter_id,name,stance,body) VALUES(?,?,?,?,?,?)').run(id, parentId, voterId, name, stance, message);
      return json(res, 201, { ok:true });
    }
  }
  if (path.startsWith('/api/admin/')) {
    if (!isAdmin(req)) return fail(res, 401, 'Invalid admin key');
    if (req.method === 'GET' && path === '/api/admin/questions') {
      const rows = db.prepare(`SELECT q.*, e.day AS publishedDay FROM questions q LEFT JOIN editions e ON e.question_id=q.id ORDER BY q.id DESC`).all();
      return json(res, 200, { questions:rows });
    }
    if (req.method === 'POST' && path === '/api/admin/questions') {
      const input = await body(req);
      const prompt = clean(input.prompt, 240), a = clean(input.optionA, 80), b = clean(input.optionB, 80);
      const date = input.scheduledDate || null;
      if (prompt.length < 10 || prompt.length > 240 || !a || a.length > 80 || !b || b.length > 80 || (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))) return fail(res, 400, 'Enter a question and two short choices');
      if (date && db.prepare('SELECT id FROM questions WHERE scheduled_date=?').get(date)) return fail(res, 409, 'That date already has a scheduled question');
      const result = db.prepare('INSERT INTO questions(prompt,option_a,option_b,scheduled_date) VALUES(?,?,?,?)').run(prompt,a,b,date);
      return json(res, 201, { id:Number(result.lastInsertRowid) });
    }
    const removeQ = /^\/api\/admin\/questions\/(\d+)$/.exec(path);
    if (req.method === 'DELETE' && removeQ) {
      const result = db.prepare('DELETE FROM questions WHERE id=? AND id NOT IN (SELECT question_id FROM editions)').run(validId(removeQ[1]));
      return result.changes ? json(res, 200, { ok:true }) : fail(res, 409, 'Only unpublished questions can be removed');
    }
    if (req.method === 'GET' && path === '/api/admin/comments') {
      const rows = db.prepare(`SELECT c.id,c.name,c.body,c.created_at AS createdAt,q.prompt
        FROM comments c JOIN questions q ON q.id=c.question_id ORDER BY c.id DESC LIMIT 100`).all();
      return json(res, 200, { comments:rows });
    }
    const removeC = /^\/api\/admin\/comments\/(\d+)$/.exec(path);
    if (req.method === 'DELETE' && removeC) {
      const result = db.prepare('DELETE FROM comments WHERE id=?').run(validId(removeC[1]));
      return result.changes ? json(res, 200, { ok:true }) : fail(res, 404, 'Comment not found');
    }
  }
  return fail(res, 404, 'Not found');
}

export function createServer() {
  return http.createServer((req, res) => {
    handler(req, res).catch(error => {
      console.error(error);
      if (!res.headersSent) fail(res, error.message === 'Invalid JSON' || error.message === 'Request too large' ? 400 : 500, error.message === 'Invalid JSON' || error.message === 'Request too large' ? error.message : 'Server error');
      else res.end();
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (adminKey.length < 24) console.warn('Set ADMIN_KEY to a random value of at least 24 characters to enable admin tools.');
  createServer().listen(port, host, () => console.log(`Opynyn listening on http://localhost:${port}`));
}
