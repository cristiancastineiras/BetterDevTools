// Firefox smoke: installs the MV3 build into a real Firefox through web-ext (remote debugging protocol).
// Playwright cannot load extensions into Firefox, so the panel UI itself is covered by the Chromium suites.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { cmd } from 'web-ext';
import { expect, FIREFOX_DIR, test } from './fixtures.ts';

const firefox = [
  process.env.FIREFOX_BIN,
  path.join(process.env.LOCALAPPDATA ?? '', 'Mozilla Firefox/firefox.exe'),
  'C:/Program Files/Mozilla Firefox/firefox.exe',
  '/usr/bin/firefox',
].find((p): p is string => Boolean(p) && existsSync(p!));

test('the Firefox MV3 build installs as a temporary add-on', async () => {
  test.skip(!firefox, 'Firefox is not installed (set FIREFOX_BIN)');
  const runner = await cmd.run(
    { sourceDir: FIREFOX_DIR, firefox, noInput: true, noReload: true, args: ['-headless'], startUrl: ['about:blank'] },
    { shouldExitProgram: false },
  );
  try {
    expect(runner).toBeTruthy(); // run() rejects when the add-on cannot be installed
  } finally {
    await runner.exit();
  }
});
