const $ = selector => document.querySelector(selector);
const el = (tag, className, value) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value != null) node.textContent = value;
  return node;
};
let mustChangePassword = false;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { 'Content-Type':'application/json' } : {}
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function showSignedOut() {
  $('#dashboard').hidden = true;
  $('#login-panel').hidden = false;
  $('#password').value = '';
}

async function showSignedIn(account) {
  mustChangePassword = account.mustChangePassword;
  $('#signed-in-as').textContent = `Signed in as ${account.username}`;
  $('#login-panel').hidden = true;
  $('#dashboard').hidden = false;
  $('#password-panel').hidden = !mustChangePassword;
  $('#admin-content').hidden = mustChangePassword;
  $('#password-help').textContent = mustChangePassword
    ? 'Your temporary password must be changed before using the dashboard.'
    : 'Enter your current password to choose a new one.';
  if (mustChangePassword) $('#current-password').focus();
  else await refresh();
}

function stat(label, value) {
  const item = el('div', 'stat-card');
  item.append(el('strong', '', Number(value).toLocaleString()), el('span', '', label));
  return item;
}

async function refresh() {
  try {
    const [stats, questions, comments] = await Promise.all([
      api('/api/admin/stats'), api('/api/admin/questions'), api('/api/admin/comments')
    ]);
    $('#stats-grid').replaceChildren(
      stat('Votes today', stats.todayVotes), stat('All votes', stats.votes),
      stat('Published debates', stats.published), stat('Queued questions', stats.queued),
      stat('Comments', stats.comments)
    );
    const list = $('#question-list');
    list.replaceChildren();
    questions.questions.forEach(q => {
      const item = el('div', 'admin-item'), description = el('div');
      description.append(el('strong', '', q.prompt), el('small', '',
        q.publishedDay ? `Published ${q.publishedDay}` : q.scheduled_date ? `Scheduled ${q.scheduled_date}` : 'Queued'));
      item.append(description);
      if (!q.publishedDay) {
        const button = el('button', 'danger-button', 'Remove');
        button.type = 'button';
        button.addEventListener('click', async () => {
          if (!confirm('Remove this unpublished question?')) return;
          try { await api(`/api/admin/questions/${q.id}`, { method:'DELETE' }); await refresh(); }
          catch (error) { alert(error.message); }
        });
        item.append(button);
      }
      list.append(item);
    });
    if (!questions.questions.length) list.append(el('p', 'empty', 'No questions yet.'));

    const moderation = $('#moderation-list');
    moderation.replaceChildren();
    if (!comments.comments.length) moderation.append(el('p', 'empty', 'No comments yet.'));
    comments.comments.forEach(comment => {
      const item = el('div', 'admin-item'), description = el('div');
      description.append(el('strong', '', `${comment.name}: ${comment.body}`),
        el('small', '', `${comment.prompt} · ${comment.createdAt} UTC`));
      const button = el('button', 'danger-button', 'Remove');
      button.type = 'button';
      button.addEventListener('click', async () => {
        if (!confirm('Permanently remove this comment?')) return;
        try { await api(`/api/admin/comments/${comment.id}`, { method:'DELETE' }); await refresh(); }
        catch (error) { alert(error.message); }
      });
      item.append(description, button);
      moderation.append(item);
    });
  } catch (error) {
    if (error.message === 'Sign in to continue') showSignedOut();
    else alert(error.message);
  }
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('#login-message').textContent = '';
  try {
    const account = await api('/api/admin/login', { method:'POST', body:JSON.stringify({
      username:$('#username').value, password:$('#password').value
    }) });
    await showSignedIn(account);
  } catch (error) { $('#login-message').textContent = error.message; }
});

$('#password-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('#password-message').textContent = '';
  if ($('#new-password').value !== $('#confirm-password').value) {
    $('#password-message').textContent = 'The new passwords do not match.';
    $('#confirm-password').focus();
    return;
  }
  try {
    await api('/api/admin/password', { method:'POST', body:JSON.stringify({
      currentPassword:$('#current-password').value, newPassword:$('#new-password').value,
      confirmPassword:$('#confirm-password').value
    }) });
    event.target.reset();
    mustChangePassword = false;
    $('#password-panel').hidden = true;
    $('#admin-content').hidden = false;
    await refresh();
  } catch (error) { $('#password-message').textContent = error.message; }
});

$('#question-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('#question-message').textContent = '';
  try {
    await api('/api/admin/questions', { method:'POST', body:JSON.stringify({
      prompt:$('#prompt').value, optionA:$('#option-a').value, optionB:$('#option-b').value,
      scheduledDate:$('#scheduled-date').value || null
    }) });
    event.target.reset();
    $('#question-message').textContent = 'Question added to the queue.';
    await refresh();
  } catch (error) { $('#question-message').textContent = error.message; }
});

$('#show-password-button').addEventListener('click', () => {
  $('#password-panel').hidden = false;
  $('#current-password').focus();
});
$('#logout-button').addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method:'POST', body:'{}' }); }
  finally { showSignedOut(); }
});

api('/api/admin/me').then(showSignedIn).catch(() => showSignedOut());
