import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Branded Edge is used when installed; Chromium always runs. Firefox is covered by the install smoke test.
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/opt/microsoft/msedge/msedge'].some((p) => existsSync(p));

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  projects: [
    { name: 'chromium', testIgnore: /firefox/, use: { channel: 'chromium' } },
    ...(edge ? [{ name: 'msedge', testMatch: /smoke|devtools/, use: { channel: 'msedge' } }] : []),
    { name: 'firefox', testMatch: /firefox/ },
  ],
});
