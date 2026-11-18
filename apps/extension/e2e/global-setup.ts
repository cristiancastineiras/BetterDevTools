import { execSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';

/** Builds the E2E variant once: Chrome (with a per-run key → known id) and Firefox. */
export default function globalSetup(): void {
  const { publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const env = { ...process.env, BDT_E2E: '1', BDT_E2E_KEY: publicKey.toString('base64') };
  const cwd = new URL('..', import.meta.url);
  execSync('pnpm exec wxt build -b chrome', { cwd, env, stdio: 'inherit' });
  execSync('pnpm exec wxt build -b firefox --mv3', { cwd, env, stdio: 'inherit' });
  // Chrome extension id: first 128 bits of sha256(public key), hex digits mapped to a–p
  const hex = createHash('sha256').update(publicKey).digest('hex').slice(0, 32);
  process.env.BDT_EXT_ID = [...hex].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join('');
}
