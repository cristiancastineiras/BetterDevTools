# Security policy

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Use GitHub's private vulnerability reporting for this repository: open the repository's **Security** tab and choose
**Report a vulnerability**. If that option is not available, open an issue that asks for a private contact route
without describing the vulnerability, and a maintainer will reply.

Helpful details: the version (see the extension's Settings → Privacy, or the release tag), the browser and its version,
the steps to reproduce, and what an attacker gains.

## Supported versions

BetterDevTools is in initial development (`0.y.z`). Fixes are made on `main` and released as a new version; older
versions are not patched.

## Scope and how the extension is built to limit risk

[docs/security.md](docs/security.md) describes the permissions the extension asks for (none at install, optional ones
requested per action), how captured data is handled, what is redacted, how untrusted input such as HAR files and
response bodies is treated, and the known limits. In particular, the extension has no telemetry and no remote
services, exports redact credentials unless you opt out, and API AutoDiscovery sessions and their exports hold no
credentials or personal data.
