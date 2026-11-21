import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const serverRoot = new URL('../', import.meta.url);
const serverEnv = new URL('.env', serverRoot);
const clientEnv = new URL('../../client/.env.local', import.meta.url);
if (!existsSync(serverEnv)) {
  const template = readFileSync(new URL('.env.example', serverRoot), 'utf8');
  writeFileSync(serverEnv, template.replace(/^BETTER_AUTH_SECRET=.*$/m, `BETTER_AUTH_SECRET=${randomBytes(48).toString('hex')}`), { flag: 'wx', mode: 0o600 });
  console.log('Created server/.env with a generated auth secret. Service credentials are still required.');
} else console.log('Preserved existing server/.env.');
if (!existsSync(clientEnv)) {
  writeFileSync(clientEnv, 'NEXT_PUBLIC_API_URL=http://localhost:5000\n', { flag: 'wx', mode: 0o600 });
  console.log('Created client/.env.local.');
} else console.log('Preserved existing client/.env.local.');
console.log(`Edit local configuration in ${fileURLToPath(serverEnv)}. Do not commit these files.`);
