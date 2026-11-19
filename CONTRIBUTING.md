# Contributing to BetterDevTools

Thanks for helping. This page covers how to run the project, what a change needs to pass, and how pull requests are
handled.

## Set up

You need Node.js 22.18 or later and `corepack` (it installs the pnpm version pinned in `package.json`).

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build:chrome            # apps/extension/.output/chrome-mv3, load it unpacked in Chrome or Edge
pnpm --filter extension dev  # WXT dev mode with reload
```

The first time you run the end-to-end tests: `pnpm --filter extension exec playwright install chromium`.

## Layout

- `packages/core`: logic with no UI or browser dependency (HAR, filters, redaction, replay building, schema inference,
  AutoDiscovery, exporters). Unit tests live in `packages/core/test`.
- `apps/extension`: the Solid UI, state and the browser adapter (`src/lib/devtools.ts` is the only module that touches
  the `devtools`, `permissions`, `cookies` and `declarativeNetRequest` APIs). Unit tests in `apps/extension/test`,
  Playwright tests in `apps/extension/e2e`.
- `docs/`: architecture, decisions (ADRs), security and privacy, TOON format, benchmarks, releasing.

## Before opening a pull request

Run what CI runs, from the repository root:

```sh
pnpm lint         # oxlint with no warnings allowed, and the oxfmt format check (pnpm format fixes formatting)
pnpm typecheck
pnpm test
pnpm build:all    # Chrome, Edge and Firefox (the Firefox build also runs web-ext lint)
pnpm test:e2e     # Playwright; needs the browsers described above
```

A pull request should:

- keep to one change, with tests for new logic (put framework-free logic in `packages/core` so it can be unit tested);
- keep user-visible text in both dictionaries (`apps/extension/src/i18n/en.ts` and `es.ts`; the Spanish one is
  type-checked against the English one);
- not add dependencies for a few lines of code, and not weaken the privacy rules in [docs/security.md](docs/security.md)
  (no telemetry, no remote services, no credentials in anything stored or exported);
- update [CHANGELOG.md](CHANGELOG.md) under `## [Unreleased]` when a user would notice the change.

## Branches and commits

Work on a short-lived branch from `main` (`feature/<name>` or `fix/<name>`) and open a pull request into `main`; CI runs on
the branch and on the pull request. [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`,
`docs:`, `refactor:`, `test:`, `chore:`) are used in the history and make the changelog easier to write, but they are not
enforced.

## Releases

Only a maintainer publishes a release, by pushing a version tag. The procedure is in
[docs/releasing.md](docs/releasing.md).

## License

No license has been chosen yet. Until one is added, please open an issue before starting a large contribution.
