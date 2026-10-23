import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('daily question, voting, comments, and moderation', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'opynyn-test-'));
  const port = await freePort();
  const bootstrap = execFileSync(process.execPath, [resolve('scripts/create-first-admin.mjs')],
    { cwd:resolve('.'), env:{ ...process.env, DATA_DIR:dir }, encoding:'utf8' });
  const temporaryPassword = /Temporary password: (\S+)/.exec(bootstrap)?.[1];
  assert.ok(temporaryPassword);
  const child = spawn(process.execPath, [resolve('server.mjs')], { cwd:resolve('.'), env:{ ...process.env, DATA_DIR:dir, PORT:String(port), TZ:'America/Edmonton' }, stdio:'pipe' });
  t.after(async () => {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    rmSync(dir, { recursive:true, force:true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i=0; i<80; i++) {
    try { if ((await fetch(`${base}/health`)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const request = async (path, method='GET', data, cookie) => {
    const response = await fetch(`${base}${path}`, { method, headers:{ ...(data ? {'Content-Type':'application/json'} : {}), ...(cookie ? {Cookie:cookie} : {}) }, body:data ? JSON.stringify(data) : undefined });
    return { status:response.status, cookie:response.headers.get('set-cookie'), body:await response.json() };
  };
  const first = await request('/api/today');
  assert.equal(first.status,200);
  assert.match(first.body.question.prompt,/public transit/);
  const cookie = first.cookie.split(';')[0];
  const qid = first.body.question.id;
  const vote = await request('/api/votes','POST',{questionId:qid,choice:'a'},cookie);
  assert.equal(vote.body.question.votes.total,1);
  assert.equal(vote.body.question.myVote,'a');
  const repeat = await request('/api/votes','POST',{questionId:qid,choice:'b'},cookie);
  assert.equal(repeat.body.question.votes.total,1);
  assert.equal(repeat.body.question.myVote,'a');
  const comment = await request(`/api/questions/${qid}/comments`,'POST',{name:'Alex',stance:'a',body:'Transit should be accessible.'},cookie);
  assert.equal(comment.status,201);
  const listed = await request(`/api/questions/${qid}/comments`);
  assert.equal(listed.body.comments.length,1);
  const tooSoon = await request(`/api/questions/${qid}/comments`,'POST',{name:'Alex',stance:'a',body:'Another take.'},cookie);
  assert.equal(tooSoon.status,429);
  const unauthorized = await request('/api/admin/questions');
  assert.equal(unauthorized.status,401);
  const login = await request('/api/admin/login','POST',{username:'owner',password:temporaryPassword});
  assert.equal(login.status,200);
  assert.equal(login.body.mustChangePassword,true);
  const temporaryCookie = login.cookie.split(';')[0];
  assert.equal((await request('/api/admin/stats','GET',undefined,temporaryCookie)).status,403);
  const newPassword = 'new-test-password-at-least-12-chars';
  const changed = await request('/api/admin/password','POST',
    {currentPassword:temporaryPassword,newPassword},temporaryCookie);
  assert.equal(changed.status,200);
  const adminCookie = changed.cookie.split(';')[0];
  assert.equal((await request('/api/admin/stats','GET',undefined,temporaryCookie)).status,401);
  assert.equal((await request('/api/admin/stats','GET',undefined,adminCookie)).body.votes,1);
  const queued = await request('/api/admin/questions','POST',{prompt:'Should libraries stay open on Sundays?',optionA:'Yes, open them',optionB:'No, close them'},adminCookie);
  assert.equal(queued.status,201);
  const removed = await request(`/api/admin/comments/${listed.body.comments[0].id}`,'DELETE',{},adminCookie);
  assert.equal(removed.status,200);
  const after = await request(`/api/questions/${qid}/comments`);
  assert.equal(after.body.comments.length,0);

  const removeQueued = await request(`/api/admin/questions/${queued.body.id}`,'DELETE',{},adminCookie);
  assert.equal(removeQueued.status,200);
  const database = new DatabaseSync(join(dir, 'opynyn.db'));
  database.prepare('DELETE FROM editions WHERE day=?').run(first.body.question.day);
  const publish = database.prepare('INSERT INTO editions(day,question_id) VALUES(?,?)');
  for (let id = 1; id <= 7; id++) publish.run(`2020-01-0${id}`,id);
  database.close();
  const recycled = await request('/api/today');
  assert.equal(recycled.status,200);
  assert.notEqual(recycled.body.question.id,qid);
  assert.equal(recycled.body.question.prompt,first.body.question.prompt);
  assert.equal(recycled.body.question.votes.total,0);
  const original = await request(`/api/questions/${qid}`, 'GET', undefined, cookie);
  assert.equal(original.body.question.votes.total,1);
  assert.equal(original.body.question.myVote,'a');
});
