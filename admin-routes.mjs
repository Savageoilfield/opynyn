import { body, fail, json } from './http-utils.mjs';
import { audit, handleAdminTools } from './admin-tools.mjs';
import { changePassword, currentAdmin, endSession, startSession, verifyLogin } from './admin-auth.mjs';

const failedLogins = new Map();
const windowMs = 15 * 60 * 1000;

async function handleAdmin(req, res, path) {
  if (!path.startsWith('/api/admin/')) return false;
  if (req.method === 'POST' && path === '/api/admin/login') {
    const client = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    for (const [address, entry] of failedLogins) if (entry.until <= now) failedLogins.delete(address);
    if (failedLogins.size > 1000) failedLogins.clear();
    const attempts = failedLogins.get(client) || { count:0, until:now + windowMs };
    if (attempts.count >= 5 && attempts.until > now) return fail(res, 429, 'Too many attempts. Try again later.');
    const input = await body(req);
    const admin = verifyLogin(input.username, input.password);
    if (!admin) {
      failedLogins.set(client, { count:attempts.count + 1, until:attempts.until });
      return fail(res, 401, 'Invalid username or password');
    }
    failedLogins.delete(client);
    startSession(req, res, admin);
    audit(admin, 'login', 'admin', admin.id);
    json(res, 200, { username:admin.username, mustChangePassword:Boolean(admin.must_change_password) });
    return true;
  }

  const admin = currentAdmin(req);
  if (!admin) { fail(res, 401, 'Sign in to continue'); return true; }
  if (req.method === 'GET' && path === '/api/admin/me') {
    json(res, 200, { username:admin.username, mustChangePassword:Boolean(admin.mustChangePassword) });
    return true;
  }
  if (req.method === 'POST' && path === '/api/admin/logout') {
    endSession(req, res);
    json(res, 200, { ok:true });
    return true;
  }
  if (req.method === 'POST' && path === '/api/admin/password') {
    const input = await body(req);
    if (input.newPassword !== input.confirmPassword) {
      fail(res, 400, 'The new passwords do not match');
      return true;
    }
    if (!changePassword(req, res, admin, input.currentPassword, input.newPassword)) {
      fail(res, 400, 'Check your current password and use a new password of at least 12 characters');
    } else {
      audit(admin, 'change_password', 'admin', admin.id);
      json(res, 200, { ok:true });
    }
    return true;
  }
  if (admin.mustChangePassword) { fail(res, 403, 'Change your temporary password first'); return true; }

  return handleAdminTools(req, res, path, admin);
}

export { handleAdmin };
