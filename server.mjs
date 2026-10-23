import http from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const starterQuestions = [
  ['Should cities make public transit free?', 'Yes, fund it publicly', 'No, riders should pay'],
  ['Should a four-day workweek become the standard?', 'Yes, with full pay', 'No, keep five days'],
  ['Should social media require age verification?', 'Yes, protect minors', 'No, protect privacy'],
  ['Should restaurants stop asking for tips?', 'Yes, include it in prices', 'No, keep tipping'],
  ['Should AI-made content always carry a label?', 'Yes, always disclose it', 'No, context matters'],
  ['Should voting day be a public holiday?', 'Yes, make voting easier', 'No, use other reforms'],
  ['Should schools ban smartphones during class?', 'Yes, ban them', 'No, allow them']
];

const publicDir = resolve('public');
const dataDir = resolve(process.env.DATA_DIR || 'data');
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, 'opynyn.db'));
db.exec(`PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY,
    prompt TEXT NOT NULL,
    option_a TEXT NOT NULL,
    option_b TEXT NOT NULL,
    scheduled_date TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS editions (
    day TEXT PRIMARY KEY,
    question_id INTEGER NOT NULL UNIQUE REFERENCES questions(id)
  );
  CREATE TABLE IF NOT EXISTS votes (
    question_id INTEGER NOT NULL REFERENCES questions(id),
    voter_id TEXT NOT NULL,
    choice TEXT NOT NULL CHECK(choice IN ('a','b')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (question_id, voter_id)
  );
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY,
    question_id INTEGER NOT NULL REFERENCES questions(id),
    parent_id INTEGER REFERENCES comments(id) ON DELETE SET NULL,
    voter_id TEXT NOT NULL,
    name TEXT NOT NULL,
    stance TEXT NOT NULL CHECK(stance IN ('a','b','unsure')),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS comments_question_idx ON comments(question_id, created_at);
  CREATE INDEX IF NOT EXISTS comments_voter_idx ON comments(voter_id, created_at);`);
if (db.prepare('SELECT count(*) AS n FROM questions').get().n === 0) {
  const insert = db.prepare('INSERT INTO questions(prompt, option_a, option_b) VALUES(?, ?, ?)');
  for (const q of starterQuestions) insert.run(...q);
}

const adminKey = process.env.ADMIN_KEY || '';
const timezone = process.env.TZ || 'America/Edmonton';
const port = Number(process.env.PORT || 3000);
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
const today = () => {
  const pieces = Object.fromEntries(dateFormat.formatToParts(new Date()).map(p => [p.type, p.value]));
  return `${pieces.year}-${pieces.month}-${pieces.day}`;
};
const json = (res, status, value, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
};
const fail = (res, status, message) => json(res, status, { error: message });
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const validId = value => /^[1-9]\d*$/.test(String(value)) ? Number(value) : null;
const clean = (value, max) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max + 1) : '';

function ensureEdition(day = today()) {
  let q = db.prepare(`SELECT q.*, e.day FROM editions e JOIN questions q ON q.id=e.question_id WHERE e.day=?`).get(day);
  if (q) return q;
  const selected = db.prepare(`SELECT * FROM questions q WHERE q.id NOT IN (SELECT question_id FROM editions)
    AND (scheduled_date IS NULL OR scheduled_date<=?)
    ORDER BY CASE WHEN scheduled_date=? THEN 0 WHEN scheduled_date IS NULL THEN 2 ELSE 1 END, q.id LIMIT 1`).get(day, day);
  if (!selected) return null;
  db.prepare('INSERT OR IGNORE INTO editions(day, question_id) VALUES(?, ?)').run(day, selected.id);
  q = db.prepare(`SELECT q.*, e.day FROM editions e JOIN questions q ON q.id=e.question_id WHERE e.day=?`).get(day);
  return q;
}

function questionView(q, voterId) {
  if (!q) return null;
  const counts = db.prepare(`SELECT
    count(*) AS total,
    sum(CASE WHEN choice='a' THEN 1 ELSE 0 END) AS a,
    sum(CASE WHEN choice='b' THEN 1 ELSE 0 END) AS b
    FROM votes WHERE question_id=?`).get(q.id);
  const mine = voterId ? db.prepare('SELECT choice FROM votes WHERE question_id=? AND voter_id=?').get(q.id, voterId) : null;
  const commentCount = db.prepare('SELECT count(*) AS n FROM comments WHERE question_id=?').get(q.id).n;
  return { id:q.id, day:q.day, prompt:q.prompt, options:{ a:q.option_a, b:q.option_b }, votes:{ a:counts.a || 0, b:counts.b || 0, total:counts.total }, myVote:mine?.choice || null, commentCount };
}

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
  createServer().listen(port, '0.0.0.0', () => console.log(`Opynyn listening on http://localhost:${port}`));
}
