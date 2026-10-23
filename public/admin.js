const $ = selector => document.querySelector(selector);
const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; };
let key = sessionStorage.getItem('opynyn_admin_key') || '';
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers:{ 'Content-Type':'application/json', 'X-Admin-Key':key } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}
async function refresh() {
  const [questions, comments] = await Promise.all([api('/api/admin/questions'),api('/api/admin/comments')]);
  $('#question-list').replaceChildren();
  questions.questions.forEach(q => {
    const item = el('div','admin-item'), text = el('div');
    text.append(el('strong','',q.prompt),el('small','',q.publishedDay ? `Published ${q.publishedDay}` : q.scheduled_date ? `Scheduled ${q.scheduled_date}` : 'Queued'));
    item.append(text);
    if (!q.publishedDay) { const button = el('button','danger-button','Remove'); button.onclick = async () => { await api(`/api/admin/questions/${q.id}`,{method:'DELETE'}); await refresh(); }; item.append(button); }
    $('#question-list').append(item);
  });
  $('#moderation-list').replaceChildren();
  if (!comments.comments.length) $('#moderation-list').append(el('p','empty','No comments yet.'));
  comments.comments.forEach(c => {
    const item = el('div','admin-item'), text = el('div');
    text.append(el('strong','',`${c.name}: ${c.body}`),el('small','',`${c.prompt} · ${c.createdAt} UTC`));
    const button = el('button','danger-button','Remove');
    button.onclick = async () => { await api(`/api/admin/comments/${c.id}`,{method:'DELETE'}); await refresh(); };
    item.append(text,button); $('#moderation-list').append(item);
  });
}
async function login() {
  key = $('#admin-key').value.trim();
  try { await refresh(); sessionStorage.setItem('opynyn_admin_key',key); $('#login-panel').hidden = true; $('#dashboard').hidden = false; }
  catch (error) { $('#login-message').textContent = error.message; }
}
$('#login-button').addEventListener('click', login);
$('#admin-key').addEventListener('keydown', event => { if (event.key === 'Enter') login(); });
$('#question-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#question-message').textContent = '';
  try {
    await api('/api/admin/questions',{method:'POST',body:JSON.stringify({prompt:$('#prompt').value,optionA:$('#option-a').value,optionB:$('#option-b').value,scheduledDate:$('#scheduled-date').value || null})});
    event.target.reset(); $('#question-message').textContent = 'Question added to the queue.'; await refresh();
  } catch (error) { $('#question-message').textContent = error.message; }
});
if (key) { $('#admin-key').value = key; login(); }
