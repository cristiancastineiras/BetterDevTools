import { browser } from 'wxt/browser';

// The devtools page only registers the panel; capture runs inside the panel document.
void browser.devtools.panels.create('BetterDevTools', 'icon/32.png', 'panel.html');
