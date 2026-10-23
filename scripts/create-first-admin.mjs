import { randomBytes } from 'node:crypto';
import { createFirstAdmin } from '../admin-auth.mjs';

const username = process.argv[2] || 'owner';
const password = randomBytes(18).toString('base64url');
try {
  createFirstAdmin(username, password);
  console.log(`Username: ${username}`);
  console.log(`Temporary password: ${password}`);
  console.log('Sign in at /admin and change this password immediately. It will not be shown again.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
