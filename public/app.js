const $ = selector => document.querySelector(selector);
const el = (tag, className, value) => { const node = document.createElement(tag); if (className) node.className = className; if (value != null) node.textContent = value; return node; };
let question = null;
let isToday = true;

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type':'application/json', ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function displayDate(day) {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' });
}

function renderQuestion() {
  $('#question-title').textContent = question?.prompt || 'A new question is on its way.';
  $('#date-label').textContent = question ? displayDate(question.day).toUpperCase() : 'COMING SOON';
  $('#issue').textContent = question ? `ISSUE ${String(question.id).padStart(3, '0')}` : 'ISSUE 001';
  $('#vote-options').replaceChildren();
  if (!question) { $('#comment-form').hidden = true; return; }
  for (const choice of ['a','b']) {
    const button = el('button', `vote-button${question.myVote === choice ? ' selected' : ''}`);
    button.type = 'button'; button.disabled = !isToday || Boolean(question.myVote);
    button.append(el('span','choice-letter',choice.toUpperCase()), el('span','choice-text',question.options[choice]));
    button.addEventListener('click', () => vote(choice));
    $('#vote-options').append(button);
  }
  $('#stance').options[0].textContent = question.options.a;
  $('#stance').options[1].textContent = question.options.b;
  $('#question-status').textContent = isToday ? (question.myVote ? 'You have made your choice.' : 'Your opinion counts.') : 'Voting and comments are closed.';
  $('#comment-form').hidden = !isToday;
  $('#vote-note').textContent = isToday && question.myVote ? 'Your vote has been counted.' : '';
  $('#result-area').hidden = !(question.myVote || !isToday);
  const total = question.votes.total;
  const a = total ? Math.round(100 * question.votes.a / total) : 0;
  const b = total ? 100 - a : 0;
  $('#total-votes').textContent = `${total.toLocaleString()} vote${total === 1 ? '' : 's'}`;
  $('#label-a').textContent = question.options.a; $('#label-b').textContent = question.options.b;
  $('#percent-a').textContent = `${a}%`; $('#percent-b').textContent = `${b}%`;
  $('#bar-a').style.width = `${a}%`; $('#bar-b').style.width = `${b}%`;
}

async function vote(choice) {
  try {
    question = (await api('/api/votes', { method:'POST', body:JSON.stringify({ questionId:question.id, choice }) })).question;
    renderQuestion();
  } catch (error) { $('#vote-note').textContent = error.message; }
}

function commentNode(comment, byId) {
  const article = el('article', `comment${comment.parentId ? ' reply' : ''}`);
  const meta = el('div','comment-meta');
  meta.append(el('span','avatar',comment.name[0]?.toUpperCase() || '?'), el('strong','',comment.name));
  const stance = el('span',`stance-pill ${comment.stance}`,comment.stance === 'unsure' ? 'Still deciding' : question.options[comment.stance]);
  meta.append(stance, el('span','comment-date',new Date(`${comment.createdAt}Z`).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})));
  article.append(meta);
  if (comment.parentId && byId.has(comment.parentId)) article.append(el('small','replying-to',`↳ Replying to ${byId.get(comment.parentId).name}`));
  article.append(el('p','',comment.body));
  if (isToday) {
    const reply = el('button','reply-button','Reply ↗'); reply.type = 'button';
    reply.addEventListener('click', () => { $('#parent-id').value = comment.id; $('#reply-context').textContent = `Replying to ${comment.name} · click to cancel`; $('#reply-context').hidden = false; $('#comment-body').focus(); });
    article.append(reply);
  }
  return article;
}

async function loadComments() {
  if (!question) return;
  const rows = (await api(`/api/questions/${question.id}/comments`)).comments;
  $('#comment-count').textContent = `${rows.length} take${rows.length === 1 ? '' : 's'}`;
  const box = $('#comments'); box.replaceChildren();
  if (!rows.length) return box.append(el('p','empty','The first take is yours to make.'));
  const byId = new Map(rows.map(row => [row.id,row]));
  rows.forEach(row => box.append(commentNode(row, byId)));
}

async function loadArchive() {
  const rows = (await api('/api/archive')).questions.filter(row => !question || row.id !== question.id);
  const box = $('#archive-list'); box.replaceChildren();
  if (!rows.length) return box.append(el('p','empty','Past debates will appear here.'));
  rows.forEach(row => {
    const link = el('a','archive-item'); link.href = `/?q=${row.id}`;
    link.append(el('span','archive-date',displayDate(row.day)),el('span','archive-title',row.prompt),el('span','archive-votes',`${row.votes} votes`),el('span','','↗'));
    box.append(link);
  });
}

$('#comment-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('#form-message').textContent = '';
  const payload = { name:$('#name').value, stance:$('#stance').value, body:$('#comment-body').value, parentId:$('#parent-id').value || null };
  try {
    await api(`/api/questions/${question.id}/comments`, { method:'POST', body:JSON.stringify(payload) });
    localStorage.setItem('opynyn_name', payload.name.trim());
    $('#comment-body').value = ''; $('#parent-id').value = ''; $('#reply-context').hidden = true;
    $('#form-message').textContent = 'Your take is live.';
    await loadComments();
  } catch (error) { $('#form-message').textContent = error.message; }
});
$('#reply-context').addEventListener('click', () => { $('#parent-id').value = ''; $('#reply-context').hidden = true; });
$('#share-button').addEventListener('click', async () => {
  const url = question ? `${location.origin}/?q=${question.id}` : location.href;
  try {
    if (navigator.share) await navigator.share({ title:question?.prompt || 'Opynyn', text:'Pick a side and make your case.', url });
    else { await navigator.clipboard.writeText(url); $('#share-button').textContent = 'Link copied ✓'; }
  } catch { /* The user may cancel the share sheet. */ }
});

async function init() {
  $('#name').value = localStorage.getItem('opynyn_name') || '';
  try {
    const today = (await api('/api/today')).question;
    const requested = new URLSearchParams(location.search).get('q');
    if (requested && Number(requested) !== today?.id) {
      question = (await api(`/api/questions/${encodeURIComponent(requested)}`)).question;
      isToday = false;
    } else question = today;
    renderQuestion();
    await Promise.all([loadComments(), loadArchive()]);
  } catch (error) { $('#question-title').textContent = 'We could not load the debate.'; $('#vote-note').textContent = error.message; }
}
init();
