# Accessibility

BetterDevTools aims to provide an accessible browser DevTools extension for keyboard and assistive-technology users.

## Supported environments

BetterDevTools supports current versions of:

- Google Chrome
- Microsoft Edge
- Mozilla Firefox 142 or later

Accessibility may also depend on the browser's DevTools accessibility support and the operating system.

## Current commitment

Contributions should preserve:

- Full keyboard operation for interactive controls.
- Visible keyboard focus.
- Semantic HTML and accessible names.
- Sufficient text and interface contrast.
- Support for browser and operating-system text scaling.
- Reduced-motion preferences where animation is used.
- English and Spanish interface text.

## Known limitations

BetterDevTools runs inside browser DevTools, so some focus behaviour, zoom handling and screen-reader announcements depend on the host browser.

Large or highly structured response bodies, virtualized request lists and interactive data trees may require additional navigation compared with ordinary document content.

## Reporting an accessibility barrier

Open a GitHub issue using the bug report template:

<https://github.com/cristiancastineiras/BetterDevTools/issues/new/choose>

Include:

- Browser, browser version and operating system.
- Assistive technology and version, if applicable.
- The affected screen or control.
- Steps to reproduce the problem.
- The expected and actual behaviour.

Do not include captured credentials, authorization headers, cookies, tokens or other sensitive traffic data. If a report contains a security vulnerability, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.