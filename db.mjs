import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const starterQuestions = [
  ['Should cities make public transit free?', 'Yes, fund it publicly', 'No, riders should pay'],
  ['Should a four-day workweek become the standard?', 'Yes, with full pay', 'No, keep five days'],
  ['Should social media require age verification?', 'Yes, protect minors', 'No, protect privacy'],
  ['Should restaurants stop asking for tips?', 'Yes, include it in prices', 'No, keep tipping'],
  ['Should AI-made content always carry a label?', 'Yes, always disclose it', 'No, context matters'],
  ['Should voting day be a public holiday?', 'Yes, make voting easier', 'No, use other reforms'],
  ['Should schools ban smartphones during class?', 'Yes, ban them', 'No, allow them']
];

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

const timezone = process.env.TZ || 'America/Edmonton';
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
const today = () => {
  const pieces = Object.fromEntries(dateFormat.formatToParts(new Date()).map(p => [p.type, p.value]));
  return `${pieces.year}-${pieces.month}-${pieces.day}`;
};
function ensureEdition(day = today()) {
  let q = db.prepare(`SELECT q.*, e.day FROM editions e JOIN questions q ON q.id=e.question_id WHERE e.day=?`).get(day);
  if (q) return q;
  let selected = db.prepare(`SELECT * FROM questions q WHERE q.id NOT IN (SELECT question_id FROM editions)
    AND (scheduled_date IS NULL OR scheduled_date<=?)
    ORDER BY CASE WHEN scheduled_date=? THEN 0 WHEN scheduled_date IS NULL THEN 2 ELSE 1 END, q.id LIMIT 1`).get(day, day);
  if (!selected) {
    const oldest = db.prepare(`SELECT q.prompt, q.option_a, q.option_b FROM editions e
      JOIN questions q ON q.id=e.question_id ORDER BY e.day ASC LIMIT 1`).get();
    if (!oldest) return null;
    const result = db.prepare('INSERT INTO questions(prompt,option_a,option_b) VALUES(?,?,?)')
      .run(oldest.prompt, oldest.option_a, oldest.option_b);
    selected = { id: Number(result.lastInsertRowid) };
  }
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

export { db, timezone, today, ensureEdition, questionView };
