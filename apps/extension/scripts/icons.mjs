// Renders assets/icon.svg to the PNG sizes the manifests need. Run: node apps/extension/scripts/icons.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const svg = readFileSync(new URL('assets/icon.svg', root), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.screenshot({ path: new URL(`public/icon/${size}.png`, root).pathname.replace(/^\/(\w:)/, '$1'), omitBackground: true });
}
await browser.close();
