// Release helper used by the GitHub Actions release workflow and runnable on any machine.
//
//   node scripts/release.mjs check vX.Y.Z      the tag is a stable SemVer tag, the extension version
//                                              matches it, and CHANGELOG.md has a section for it
//   node scripts/release.mjs package vX.Y.Z    after `pnpm zip:all`: checks what is inside each zip
//                                              and writes dist/ (named zips, SHA256SUMS.txt, notes)
//
// The version lives in one place: apps/extension/package.json (WXT writes it into every manifest).
// The tag only names the commit being released, and must agree with it.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'apps/extension/.output');
const dist = resolve(root, 'dist');
const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const BROWSERS = ['chrome', 'edge', 'firefox'];

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const extensionVersion = () => readJson(resolve(root, 'apps/extension/package.json')).version;

/** The body of the `## [x.y.z]` section of CHANGELOG.md, or null. */
function changelogSection(version) {
  const text = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8').replaceAll('\r\n', '\n');
  const heading = new RegExp(`^## \\[${version.replaceAll('.', '\\.')}\\][^\\n]*\\n`, 'm').exec(text);
  if (!heading) return null;
  const rest = text.slice(heading.index + heading[0].length);
  const next = rest.search(/^## \[/m);
  return (next < 0 ? rest : rest.slice(0, next)).trim() || null;
}

function checkTag(tag) {
  if (!STABLE_TAG.test(tag)) fail(`"${tag}" is not a stable release tag (expected vMAJOR.MINOR.PATCH, e.g. v1.2.3)`);
  const version = tag.slice(1);
  if (version !== extensionVersion()) {
    fail(`tag ${tag} does not match apps/extension/package.json (${extensionVersion()}); bump the version before tagging`);
  }
  if (!changelogSection(version)) fail(`CHANGELOG.md has no filled-in "## [${version}]" section`);
  return version;
}

/** Reads one file out of a zip, using only Node: the central directory, then the local entry. */
function readFromZip(zipPath, name) {
  const zip = readFileSync(zipPath);
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) fail(`${zipPath} is not a zip file`);
  const entries = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  for (let index = 0; index < entries; index++) {
    const method = zip.readUInt16LE(at + 10);
    const compressed = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const entryName = zip.toString('utf8', at + 46, at + 46 + nameLength);
    if (entryName === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + compressed);
      return method === 0 ? data : inflateRawSync(data);
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function packageRelease(tag) {
  const version = checkTag(tag);
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  const files = [];

  for (const browser of BROWSERS) {
    const zip = resolve(output, `extension-${version}-${browser}.zip`);
    if (!existsSync(zip)) fail(`${zip} was not built (run pnpm zip:all first)`);
    const raw = readFromZip(zip, 'manifest.json');
    if (!raw) fail(`${zip} has no manifest.json at its root`);
    const manifest = JSON.parse(raw.toString('utf8'));
    if (manifest.manifest_version !== 3) fail(`${browser}: manifest_version is ${manifest.manifest_version}, expected 3`);
    if (manifest.name !== 'BetterDevTools') fail(`${browser}: unexpected name "${manifest.name}"`);
    if (manifest.version !== version) fail(`${browser}: manifest version ${manifest.version} does not match ${version}`);
    if (browser === 'firefox' && !manifest.browser_specific_settings?.gecko?.id) fail('firefox: the manifest has no gecko id');
    if (browser !== 'firefox' && !manifest.minimum_chrome_version) fail(`${browser}: the manifest has no minimum_chrome_version`);
    const target = `betterdevtools-${tag}-${browser}.zip`;
    copyFileSync(zip, resolve(dist, target));
    files.push(target);
  }

  // Firefox reviewers need the sources the build came from
  const sources = resolve(output, `extension-${version}-sources.zip`);
  if (!existsSync(sources)) fail(`${sources} was not built (the Firefox zip comes with it)`);
  copyFileSync(sources, resolve(dist, `betterdevtools-${tag}-firefox-sources.zip`));
  files.push(`betterdevtools-${tag}-firefox-sources.zip`);

  writeFileSync(resolve(dist, 'SHA256SUMS.txt'), `${files.map((file) => `${sha256(resolve(dist, file))}  ${file}`).join('\n')}\n`);
  writeFileSync(
    resolve(dist, 'release-notes.md'),
    `${changelogSection(version)}

## Install

- **Chrome / Edge:** unzip \`betterdevtools-${tag}-chrome.zip\` (or \`-edge\`), open \`chrome://extensions\` or \`edge://extensions\`, enable Developer mode, choose _Load unpacked_ and pick the folder. Then open DevTools and the **BetterDevTools** tab.
- **Firefox (142+):** \`about:debugging\` → _This Firefox_ → _Load Temporary Add-on_ → pick the \`manifest.json\` inside the unzipped \`betterdevtools-${tag}-firefox.zip\`.

Verify downloads with \`SHA256SUMS.txt\`.
`,
  );
  console.log(`release: ${tag} packaged in dist/`);
  for (const file of files) console.log(`  ${file}`);
}

const [command, tag] = process.argv.slice(2);
if (command === 'check' && tag) {
  checkTag(tag);
  console.log(`release: ${tag} is valid (matches apps/extension/package.json and CHANGELOG.md)`);
} else if (command === 'package' && tag) {
  packageRelease(tag);
} else {
  fail('usage: node scripts/release.mjs <check|package> vX.Y.Z');
}
