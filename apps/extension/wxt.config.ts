import solid from '@solidjs/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// E2E builds pre-grant the local test server so replay never waits on a permission prompt.
const e2e = process.env.BDT_E2E === '1';

export default defineConfig({
  outDir: e2e ? '.output-e2e' : '.output',
  vite: () => ({
    plugins: [solid({ performanceTracks: false }), tailwindcss()],
    build: { target: 'esnext' },
  }),
  manifest: ({ browser }) => ({
    name: 'BetterDevTools',
    description: 'Inspect, replay, compare and export HTTP traffic from a DevTools panel. Local only, no telemetry.',
    // E2E only: a per-run public key gives a predictable extension id; no key ships in release builds.
    ...(e2e
      ? {
          host_permissions: ['http://127.0.0.1/*'],
          permissions: ['cookies', 'declarativeNetRequestWithHostAccess'],
          key: process.env.BDT_E2E_KEY,
        }
      : {}),
    // Asked per origin at replay time; capture itself needs no permission.
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    // Asked only when the user edits browser cookies or sends edited cookies with a replay.
    optional_permissions: ['cookies', 'declarativeNetRequestWithHostAccess'],
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'" },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: { id: 'betterdevtools@local', strict_min_version: '142.0', data_collection_permissions: { required: ['none'] } },
          },
        }
      : { minimum_chrome_version: '126' }),
  }),
});
