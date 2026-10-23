import { db, today } from './db.mjs';
import { body, clean, fail, json, validId } from './http-utils.mjs';

const count = (sql, ...params) => db.prepare(sql).get(...params).n;
const audit = (admin, action, targetType, targetId) => db.prepare(
  'INSERT INTO admin_activity(admin_id,action,target_type,target_id) VALUES(?,?,?,?)'
).run(admin.id, action, targetType, targetId);

function questionInput(input) {
  const prompt = clean(input.prompt, 240), a = clean(input.optionA, 80), b = clean(input.optionB, 80);
  const date = input.scheduledDate || null;
  if (prompt.length < 10 || prompt.length > 240 || !a || a.length > 80 || !b || b.length > 80 ||
    (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))) return null;
  return { prompt, a, b, date };
}

function summaryRows() {
  return db.prepare(`SELECT e.day,q.id,q.prompt,
    (SELECT count(*) FROM votes v WHERE v.question_id=q.id AND v.choice='a') AS votesA,
    (SELECT count(*) FROM votes v WHERE v.question_id=q.id AND v.choice='b') AS votesB,
    (SELECT count(*) FROM comments c WHERE c.question_id=q.id AND c.status='visible') AS comments
    FROM editions e JOIN questions q ON q.id=e.question_id ORDER BY e.day DESC LIMIT 90`).all();
}

function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

async function handleAdminTools(req, res, path, admin) {
  const params = new URL(req.url || '/', 'http://localhost').searchParams;
  if (req.method === 'GET' && path === '/api/admin/stats') {
    json(res, 200, {
      published:count('SELECT count(*) AS n FROM editions'),
      queued:count('SELECT count(*) AS n FROM questions WHERE id NOT IN (SELECT question_id FROM editions)'),
      votes:count('SELECT count(*) AS n FROM votes'),
      todayVotes:count('SELECT count(*) AS n FROM votes v JOIN editions e ON e.question_id=v.question_id WHERE e.day=?', today()),
      comments:count("SELECT count(*) AS n FROM comments WHERE status='visible'"),
      hidden:count("SELECT count(*) AS n FROM comments WHERE status='hidden'"),
      openReports:count("SELECT count(*) AS n FROM comment_reports WHERE status='open'")
    });
    return;
  }
  if (req.method === 'GET' && path === '/api/admin/summary') {
    json(res, 200, { rows:summaryRows() }); return;
  }
  if (req.method === 'GET' && path === '/api/admin/summary.csv') {
    const rows = summaryRows();
    const csv = [['day','question_id','question','votes_a','votes_b','visible_comments'],
      ...rows.map(row => [row.day,row.id,row.prompt,row.votesA,row.votesB,row.comments])]
      .map(row => row.map(csvCell).join(',')).join('\r\n');
    res.writeHead(200, { 'Content-Type':'text/csv; charset=utf-8', 'Content-Disposition':'attachment; filename="opynyn-summary.csv"', 'Cache-Control':'no-store' });
    res.end(csv);
    return;
  }
  if (req.method === 'GET' && path === '/api/admin/activity') {
    const rows = db.prepare(`SELECT a.action,a.target_type AS targetType,a.target_id AS targetId,
      a.created_at AS createdAt,u.username FROM admin_activity a JOIN admins u ON u.id=a.admin_id
      ORDER BY a.id DESC LIMIT 50`).all();
    json(res, 200, { activity:rows }); return;
  }
  if (req.method === 'GET' && path === '/api/admin/questions') {
    const questions = db.prepare(`SELECT q.*,e.day AS publishedDay FROM questions q
      LEFT JOIN editions e ON e.question_id=q.id ORDER BY q.id DESC`).all();
    json(res, 200, { questions }); return;
  }
  if (req.method === 'POST' && path === '/api/admin/questions') {
    const input = questionInput(await body(req));
    if (!input) return fail(res, 400, 'Enter a question and two short choices');
    if (input.date && db.prepare('SELECT id FROM questions WHERE scheduled_date=?').get(input.date)) {
      return fail(res, 409, 'That date already has a scheduled question');
    }
    const result = db.prepare('INSERT INTO questions(prompt,option_a,option_b,scheduled_date) VALUES(?,?,?,?)')
      .run(input.prompt,input.a,input.b,input.date);
    audit(admin, 'create', 'question', Number(result.lastInsertRowid));
    json(res, 201, { id:Number(result.lastInsertRowid) }); return;
  }
  const questionMatch = /^\/api\/admin\/questions\/(\d+)$/.exec(path);
  if (questionMatch && ['PATCH','DELETE'].includes(req.method)) {
    const id = validId(questionMatch[1]);
    const unpublished = db.prepare('SELECT id FROM questions WHERE id=? AND id NOT IN (SELECT question_id FROM editions)').get(id);
    if (!unpublished) return fail(res, 409, 'Only unpublished questions can be changed');
    if (req.method === 'DELETE') {
      db.prepare('DELETE FROM questions WHERE id=?').run(id);
      audit(admin, 'delete', 'question', id);
      json(res, 200, { ok:true }); return;
    }
    const input = questionInput(await body(req));
    if (!input) return fail(res, 400, 'Enter a question and two short choices');
    if (input.date && db.prepare('SELECT id FROM questions WHERE scheduled_date=? AND id<>?').get(input.date,id)) {
      return fail(res, 409, 'That date already has a scheduled question');
    }
    db.prepare('UPDATE questions SET prompt=?,option_a=?,option_b=?,scheduled_date=? WHERE id=?')
      .run(input.prompt,input.a,input.b,input.date,id);
    audit(admin, 'edit', 'question', id);
    json(res, 200, { ok:true }); return;
  }
  if (req.method === 'GET' && path === '/api/admin/comments') {
    const status = params.get('status') || 'all';
    if (!['all','visible','hidden'].includes(status)) return fail(res, 400, 'Invalid status');
    const search = (params.get('q') || '').trim().slice(0, 100);
    const term = `%${search}%`;
    const rows = db.prepare(`SELECT c.id,c.name,c.body,c.status,c.created_at AS createdAt,q.prompt,
      (SELECT count(*) FROM comment_reports r WHERE r.comment_id=c.id AND r.status='open') AS openReports
      FROM comments c JOIN questions q ON q.id=c.question_id
      WHERE (?='all' OR c.status=?) AND (?='' OR c.body LIKE ? OR c.name LIKE ? OR q.prompt LIKE ?)
      ORDER BY c.id DESC LIMIT 100`).all(status,status,search,term,term,term);
    json(res, 200, { comments:rows }); return;
  }
  const commentMatch = /^\/api\/admin\/comments\/(\d+)$/.exec(path);
  if (commentMatch && ['PATCH','DELETE'].includes(req.method)) {
    const id = validId(commentMatch[1]);
    const comment = db.prepare('SELECT id,status FROM comments WHERE id=?').get(id);
    if (!comment) return fail(res, 404, 'Comment not found');
    if (req.method === 'DELETE') {
      db.prepare('DELETE FROM comments WHERE id=?').run(id);
      audit(admin, 'delete', 'comment', id);
      json(res, 200, { ok:true }); return;
    }
    const input = await body(req);
    if (!['visible','hidden'].includes(input.status)) return fail(res, 400, 'Invalid comment status');
    db.prepare('UPDATE comments SET status=? WHERE id=?').run(input.status,id);
    if (input.status === 'hidden') db.prepare("UPDATE comment_reports SET status='resolved' WHERE comment_id=? AND status='open'").run(id);
    if (input.status !== comment.status) audit(admin, input.status === 'hidden' ? 'hide' : 'restore', 'comment', id);
    json(res, 200, { ok:true }); return;
  }
  if (req.method === 'GET' && path === '/api/admin/reports') {
    const status = params.get('status') || 'open';
    if (!['open','resolved','dismissed','all'].includes(status)) return fail(res, 400, 'Invalid report status');
    const reports = db.prepare(`SELECT r.id,r.reason,r.status,r.created_at AS createdAt,
      c.id AS commentId,c.name,c.body,c.status AS commentStatus,q.prompt
      FROM comment_reports r JOIN comments c ON c.id=r.comment_id
      JOIN questions q ON q.id=c.question_id
      WHERE (?='all' OR r.status=?) ORDER BY r.id DESC LIMIT 100`).all(status,status);
    json(res, 200, { reports }); return;
  }
  const reportMatch = /^\/api\/admin\/reports\/(\d+)$/.exec(path);
  if (req.method === 'PATCH' && reportMatch) {
    const id = validId(reportMatch[1]);
    const input = await body(req);
    if (!['resolved','dismissed'].includes(input.status)) return fail(res, 400, 'Invalid report status');
    const result = db.prepare('UPDATE comment_reports SET status=? WHERE id=?').run(input.status,id);
    if (!result.changes) return fail(res, 404, 'Report not found');
    audit(admin, input.status, 'report', id);
    json(res, 200, { ok:true }); return;
  }
  fail(res, 404, 'Not found');
}

export { handleAdminTools, audit };
