import { $, el, api } from './admin-common.js';

const reasonLabels = { spam:'Spam', abuse:'Abuse or harassment', privacy:'Personal information', other:'Other concern' };
const notice = message => { $('#admin-message').textContent = message; };
const button = (label, className, action) => {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
};
const item = (title, detail) => {
  const row = el('div', 'admin-item');
  const text = el('div', 'admin-item-text');
  text.append(el('strong', '', title), el('small', '', detail));
  row.append(text);
  return row;
};
const empty = (box, message) => box.append(el('p', 'empty', message));

async function run(action, success = '') {
  try {
    await action();
    notice(success);
    await refreshDashboard();
  } catch (error) { notice(error.message); }
}

function renderStats(stats, rows) {
  const cards = [
    ['Votes today',stats.todayVotes], ['All votes',stats.votes],
    ['Published debates',stats.published], ['Queued questions',stats.queued],
    ['Visible comments',stats.comments], ['Open reports',stats.openReports]
  ];
  $('#stats-grid').replaceChildren(...cards.map(([label,value]) => {
    const card = el('div', 'stat-card');
    card.append(el('strong', '', Number(value).toLocaleString()), el('span', '', label));
    return card;
  }));
  const box = $('#summary-list');
  box.replaceChildren();
  if (!rows.length) return empty(box, 'No published debates yet.');
  rows.slice(0, 7).forEach(row => {
    const total = row.votesA + row.votesB;
    box.append(item(row.prompt, `${row.day} · ${total} vote${total === 1 ? '' : 's'} · ${row.comments} visible take${row.comments === 1 ? '' : 's'}`));
  });
}

function resetQuestionForm() {
  $('#question-form').reset();
  $('#edit-question-id').value = '';
  $('#question-form-title').textContent = 'Queue a question';
  $('#save-question-button').textContent = 'Add to queue ↗';
  $('#cancel-question-edit').hidden = true;
}

function editQuestion(question) {
  $('#edit-question-id').value = question.id;
  $('#prompt').value = question.prompt;
  $('#option-a').value = question.option_a;
  $('#option-b').value = question.option_b;
  $('#scheduled-date').value = question.scheduled_date || '';
  $('#question-form-title').textContent = 'Edit queued question';
  $('#save-question-button').textContent = 'Save changes ↗';
  $('#cancel-question-edit').hidden = false;
  $('#question-form').scrollIntoView({ behavior:'smooth', block:'start' });
  $('#prompt').focus();
}

function renderQuestions(questions) {
  const box = $('#question-list');
  box.replaceChildren();
  if (!questions.length) return empty(box, 'No questions yet.');
  questions.forEach(question => {
    const state = question.publishedDay ? `Published ${question.publishedDay}` :
      question.scheduled_date ? `Scheduled ${question.scheduled_date}` : 'Queued';
    const row = item(question.prompt, `${state} · ${question.option_a} / ${question.option_b}`);
    if (!question.publishedDay) {
      const actions = el('div', 'admin-actions');
      actions.append(
        button('Edit', 'small-button', () => editQuestion(question)),
        button('Remove', 'danger-button', () => {
          if (confirm('Remove this unpublished question?')) run(() => api(`/api/admin/questions/${question.id}`, { method:'DELETE', body:'{}' }), 'Question removed.');
        })
      );
      row.append(actions);
    }
    box.append(row);
  });
}

function renderReports(reports) {
  const box = $('#report-list');
  box.replaceChildren();
  if (!reports.length) return empty(box, 'No reports in this view.');
  reports.forEach(report => {
    const row = item(`${report.name}: ${report.body}`, `${reasonLabels[report.reason]} · ${report.prompt} · ${report.createdAt} UTC · ${report.status}`);
    const actions = el('div', 'admin-actions');
    if (report.status === 'open') {
      if (report.commentStatus === 'visible') actions.append(button('Hide comment', 'danger-button', () =>
        run(() => api(`/api/admin/comments/${report.commentId}`, { method:'PATCH', body:JSON.stringify({status:'hidden'}) }), 'Comment hidden and reports resolved.')));
      actions.append(button('Resolve', 'small-button', () =>
        run(() => api(`/api/admin/reports/${report.id}`, { method:'PATCH', body:JSON.stringify({status:'resolved'}) }), 'Report resolved.')));
      actions.append(button('Dismiss', 'text-link', () =>
        run(() => api(`/api/admin/reports/${report.id}`, { method:'PATCH', body:JSON.stringify({status:'dismissed'}) }), 'Report dismissed.')));
    }
    row.append(actions);
    box.append(row);
  });
}

function renderComments(comments) {
  const box = $('#moderation-list');
  box.replaceChildren();
  if (!comments.length) return empty(box, 'No comments match this filter.');
  comments.forEach(comment => {
    const row = item(`${comment.name}: ${comment.body}`,
      `${comment.prompt} · ${comment.createdAt} UTC · ${comment.status}${comment.openReports ? ` · ${comment.openReports} open report(s)` : ''}`);
    const actions = el('div', 'admin-actions');
    const next = comment.status === 'hidden' ? 'visible' : 'hidden';
    actions.append(button(next === 'hidden' ? 'Hide' : 'Restore', 'small-button', () =>
      run(() => api(`/api/admin/comments/${comment.id}`, { method:'PATCH', body:JSON.stringify({status:next}) }), `Comment ${next === 'hidden' ? 'hidden' : 'restored'}.`)));
    actions.append(button('Delete', 'danger-button', () => {
      if (confirm('Permanently delete this comment and its reports?')) run(() => api(`/api/admin/comments/${comment.id}`, { method:'DELETE', body:'{}' }), 'Comment deleted.');
    }));
    row.append(actions);
    box.append(row);
  });
}

function renderActivity(activity) {
  const box = $('#activity-list');
  box.replaceChildren();
  if (!activity.length) return empty(box, 'No admin actions yet.');
  activity.forEach(entry => box.append(item(`${entry.username} · ${entry.action.replaceAll('_',' ')}`,
    `${entry.targetType} #${entry.targetId ?? '—'} · ${entry.createdAt} UTC`)));
}

async function refreshDashboard() {
  const [stats, summary, questions, reports, comments, activity] = await Promise.all([
    api('/api/admin/stats'), api('/api/admin/summary'), api('/api/admin/questions'),
    api(`/api/admin/reports?status=${encodeURIComponent($('#report-filter').value)}`),
    api(`/api/admin/comments?status=${encodeURIComponent($('#comment-filter').value)}&q=${encodeURIComponent($('#comment-search').value)}`),
    api('/api/admin/activity')
  ]);
  renderStats(stats, summary.rows);
  renderQuestions(questions.questions);
  renderReports(reports.reports);
  renderComments(comments.comments);
  renderActivity(activity.activity);
}

function bindTools() {
  $('#question-form').addEventListener('submit', async event => {
    event.preventDefault();
    const id = $('#edit-question-id').value;
    const payload = {
      prompt:$('#prompt').value, optionA:$('#option-a').value, optionB:$('#option-b').value,
      scheduledDate:$('#scheduled-date').value || null
    };
    try {
      await api(id ? `/api/admin/questions/${id}` : '/api/admin/questions',
        { method:id ? 'PATCH' : 'POST', body:JSON.stringify(payload) });
      resetQuestionForm();
      $('#question-message').textContent = id ? 'Question updated.' : 'Question added to the queue.';
      await refreshDashboard();
    } catch (error) { $('#question-message').textContent = error.message; }
  });
  $('#cancel-question-edit').addEventListener('click', resetQuestionForm);
  $('#report-filter').addEventListener('change', () => refreshDashboard().catch(error => notice(error.message)));
  $('#comment-filter').addEventListener('change', () => refreshDashboard().catch(error => notice(error.message)));
  let timer;
  $('#comment-search').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => refreshDashboard().catch(error => notice(error.message)), 250);
  });
}

export { bindTools, refreshDashboard };
