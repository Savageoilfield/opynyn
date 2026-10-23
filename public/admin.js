import { $, api } from './admin-common.js';
import { bindTools, refreshDashboard } from './admin-tools.js';

function showSignedOut() {
  $('#dashboard').hidden = true;
  $('#login-panel').hidden = false;
  $('#password').value = '';
  $('#password-form').reset();
}

async function showSignedIn(account) {
  $('#signed-in-as').textContent = `Signed in as ${account.username}`;
  $('#login-panel').hidden = true;
  $('#dashboard').hidden = false;
  $('#password-panel').hidden = !account.mustChangePassword;
  $('#admin-content').hidden = account.mustChangePassword;
  $('#password-help').textContent = account.mustChangePassword
    ? 'Your temporary password must be changed before using the dashboard.'
    : 'Enter your current password to choose a new one.';
  if (account.mustChangePassword) $('#current-password').focus();
  else await refreshDashboard();
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
    $('#password-panel').hidden = true;
    $('#admin-content').hidden = false;
    await refreshDashboard();
  } catch (error) { $('#password-message').textContent = error.message; }
});

$('#show-password-button').addEventListener('click', () => {
  $('#password-panel').hidden = false;
  $('#current-password').focus();
});
$('#logout-button').addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method:'POST', body:'{}' }); }
  finally { showSignedOut(); }
});

bindTools();
api('/api/admin/me').then(showSignedIn).catch(showSignedOut);
