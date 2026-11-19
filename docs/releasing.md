# Releasing

A release is a deliberate decision: continuous integration runs on every change, but a version is published only when a
maintainer pushes an annotated version tag. Nothing else (a push to `main`, a pull request, a branch) creates one.

| Event                                  | Workflow             | Result                                                            |
| -------------------------------------- | -------------------- | ----------------------------------------------------------------- |
| Push to `main`, `feature/**`, `fix/**` | `ci.yml`             | lint, type check, unit tests, builds, end-to-end tests            |
| Pull request into `main`               | `ci.yml`             | the same, as a required check                                     |
| Push of a stable tag `vX.Y.Z`          | `release.yml`        | validates, builds Chrome/Edge/Firefox, creates the GitHub Release |
| Manual run                             | `publish-stores.yml` | optional: sends a release's packages to the browser stores        |

## Versioning

[Semantic Versioning](https://semver.org/spec/v2.0.0.html): `MAJOR.MINOR.PATCH`, tags `vMAJOR.MINOR.PATCH`.

| Change                                                  | Increment | Example           |
| ------------------------------------------------------- | --------- | ----------------- |
| Incompatible change to saved data, exports or behaviour | MAJOR     | `1.4.2` → `2.0.0` |
| Backward-compatible functionality                       | MINOR     | `1.4.2` → `1.5.0` |
| Backward-compatible bug fix                             | PATCH     | `1.4.2` → `1.4.3` |

The project is in initial development (`0.y.z`), where any release may change behaviour; use `0.MINOR.0` for features and
`0.y.PATCH` for fixes until a `1.0.0` compatibility promise is made. A version number is never reused.

**The version lives in one place:** `version` in `apps/extension/package.json`. WXT writes it into every browser's
manifest. The tag only names the commit being released, and `release.yml` refuses a tag that disagrees with it.

## Publish a release

1. Decide the version from the changes since the last tag, and move the `## [Unreleased]` notes in
   [CHANGELOG.md](../CHANGELOG.md) under a new `## [X.Y.Z] - YYYY-MM-DD` heading (and update the links at the bottom).
2. Set `version` in `apps/extension/package.json` to `X.Y.Z`. Commit both through a pull request into `main` and wait for CI.
3. Check that it will pass, on the commit you are about to tag:

   ```sh
   git checkout main && git pull --ff-only origin main
   git status --short                       # must be empty
   pnpm install --frozen-lockfile
   pnpm lint && pnpm typecheck && pnpm test
   pnpm zip:all                             # chrome, edge and firefox zips
   pnpm test:e2e
   node scripts/release.mjs check vX.Y.Z    # tag format, version, changelog
   node scripts/release.mjs package vX.Y.Z  # checks each zip's manifest, writes dist/
   ```

4. Create and push the annotated tag:

   ```sh
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   git push origin vX.Y.Z
   ```

5. Follow the **Release** workflow. It checks the tag is annotated and on `main`, re-runs lint, type check and unit
   tests, builds the three browsers from that commit, and the `publish` job creates the GitHub Release with the
   changelog section as its notes and these files attached:

   - `betterdevtools-vX.Y.Z-chrome.zip`, `-edge.zip` and `-firefox.zip` (the Chrome and Edge packages contain the same
     files; both are attached so each store gets the file with its name),
   - `betterdevtools-vX.Y.Z-firefox-sources.zip`, the sources Firefox reviewers ask for,
   - `SHA256SUMS.txt`.

6. Open the release page and check the notes and the attached files.

Never move, delete or re-push a published tag. If a release is defective, fix it and publish the next patch version, and
say so in the changelog.

## Pre-releases

`release.yml` matches stable tags only. For `v1.0.0-rc.1` style tags, add a separate workflow with its own pattern that
publishes with `gh release create --prerelease`, so a pre-release is never the "latest" stable release.

## Publishing to the browser stores (optional)

A GitHub Release does not publish to any store. The `publish-stores.yml` workflow (manual) takes a release tag, downloads
that release's zips and submits them with `wxt submit`. It uses the `store-publish` environment (create it in the
repository settings and add required reviewers) and these secrets in it:

| Store                     | Secrets                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Chrome Web Store (API v2) | `CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID`, `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL`, `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` |
| Microsoft Edge Add-ons    | `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`, `EDGE_API_KEY`                                                                       |
| Firefox Add-ons           | `FIREFOX_EXTENSION_ID`, `FIREFOX_JWT_ISSUER`, `FIREFOX_JWT_SECRET`                                                        |

Run it first with **dry run** on (the default): it checks the credentials and uploads nothing. Before a first Firefox
submission, replace the placeholder add-on id `betterdevtools@local` (in `apps/extension/wxt.config.ts`) with the real id
of the listing. This workflow needs store accounts and secrets, so it has not been run.

## Recommended repository settings

These cannot be committed; set them in GitHub (Settings):

- protect `main`: require a pull request and the **Validate** check from `ci.yml`;
- a ruleset for tags `v*` that restricts who can create them and blocks deleting or force-updating them;
- Actions → General → Workflow permissions: read repository contents by default (each workflow asks for what it needs);
- enable **private vulnerability reporting** (used by [SECURITY.md](../SECURITY.md));
- optionally enable immutable releases, so a published release's tag and files cannot change.

The actions used by the workflows are pinned to full commit SHAs; Dependabot (`.github/dependabot.yml`) proposes updates.

## If something goes wrong

| Situation                                    | What to do                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| The release workflow fails before publishing | Fix the cause. If the tag was never published, delete it locally and on the remote, fix, and tag again. |
| A release is published with a defect         | Publish a new patch version. Do not replace the files of the existing release.                          |
| A store submission is rejected               | Fix, publish a new version, submit again; the GitHub Release stays as it is.                            |
