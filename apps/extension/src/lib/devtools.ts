// Browser adapter: the only module that touches devtools.*, permissions.*, cookies.* and
// declarativeNetRequest.* APIs. Chrome/Edge and Firefox differences are handled here.
import { makeBody, type Body, type BuiltRequest } from '@betterdevtools/core';
import { browser, type Browser } from 'wxt/browser';

export const isFirefox = import.meta.env.FIREFOX;

/** False when the panel page is opened outside DevTools (tests, direct URL): import still works. */
export const devtoolsAvailable = (): boolean => Boolean(browser.devtools?.network);

export const extensionVersion = (): string => browser.runtime.getManifest().version;

/** Settles with `fallback` if `promise` takes longer than `ms`; the original promise keeps running. */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

// ----------------------------------------------------------------------------------- capture

/**
 * Reads a response body through the request object DevTools handed us. Chrome/Edge call back with
 * (content, encoding); Firefox resolves to [content, mimeType]. Entries without getContent
 * (Firefox getHAR) report the body as unavailable.
 */
export async function readContent(entry: unknown, size: number): Promise<Body> {
  if (typeof entry !== 'object' || entry === null || !('getContent' in entry) || typeof entry.getContent !== 'function') {
    return makeBody(null, undefined, size, 'Recorded before this panel opened; the browser exposes no body for it');
  }
  const getContent = entry.getContent.bind(entry);
  try {
    if (isFirefox) {
      const result: unknown = await getContent();
      const [text, second] = Array.isArray(result) ? result : [result];
      return makeBody(typeof text === 'string' ? text : null, second === 'base64' ? 'base64' : undefined, size);
    }
    return await new Promise<Body>((resolve) => {
      getContent((content: unknown, encoding: unknown) =>
        resolve(makeBody(typeof content === 'string' ? content : null, typeof encoding === 'string' ? encoding : undefined, size)),
      );
    });
  } catch (error) {
    return makeBody(null, undefined, size, `Reading the body failed: ${String(error)}`);
  }
}

export interface CaptureHandlers {
  onRequest(raw: unknown): void;
  onNavigated(url: string): void;
}

/** Subscribes to finished requests and navigations; returns the unsubscribe function. */
export function startCapture(handlers: CaptureHandlers): () => void {
  const network = browser.devtools.network;
  network.onRequestFinished.addListener(handlers.onRequest);
  network.onNavigated.addListener(handlers.onNavigated);
  return () => {
    network.onRequestFinished.removeListener(handlers.onRequest);
    network.onNavigated.removeListener(handlers.onNavigated);
  };
}

/** Requests DevTools recorded before the panel opened. */
export async function recordedEntries(): Promise<unknown[]> {
  const network = browser.devtools.network;
  const harLog: unknown = isFirefox ? await network.getHAR() : await new Promise((resolve) => network.getHAR(resolve));
  return typeof harLog === 'object' && harLog !== null && 'entries' in harLog && Array.isArray(harLog.entries) ? harLog.entries : [];
}

// ------------------------------------------------------------------------------- permissions

const PERMISSION_TIMEOUT_MS = 30_000;

const originPattern = (url: string) => {
  const parsed = URL.parse(url);
  return parsed ? `${parsed.protocol}//${parsed.hostname}/*` : null;
};

/**
 * Asks for access to one origin so the extension can read its responses. Resolves true when
 * granted, false when refused, null when this context cannot ask (Firefox DevTools panels) or the
 * prompt never answers: a DevTools panel cannot always show it, and the send must not hang on it.
 */
export async function requestOrigin(url: string): Promise<boolean | null> {
  const pattern = originPattern(url);
  const permissions = browser.permissions;
  if (!pattern || typeof permissions?.request !== 'function') return null;
  try {
    return await withTimeout(permissions.request({ origins: [pattern] }), PERMISSION_TIMEOUT_MS, null);
  } catch {
    return null; // no user gesture or API unavailable here: the send continues as a plain CORS request
  }
}

/** Optional permissions are asked for only when the user starts the action that needs them. Returns why not, or null. */
async function requestPermissions(permissions: Browser.runtime.ManifestPermission[], url: string): Promise<string | null> {
  const api = browser.permissions;
  const pattern = originPattern(url);
  if (typeof api?.request !== 'function' || !pattern) return 'not available in this browser’s DevTools panel';
  try {
    const granted = await withTimeout(api.request({ permissions, origins: [pattern] }), PERMISSION_TIMEOUT_MS, null);
    return granted ? null : granted === null ? 'the permission prompt did not answer' : 'permission was refused';
  } catch (error) {
    return `permission request failed: ${String(error)}`;
  }
}

// ------------------------------------------------------------------ replay from the inspected page

/** What a fetch() run inside the inspected page reports back. */
export interface PageFetchResult {
  status: number;
  statusText: string;
  url: string;
  redirected: boolean;
  headers: [string, string][];
  /** Response bytes, base64-encoded (inspectedWindow.eval only carries JSON). */
  base64: string;
  truncated: boolean;
}

const PAGE_POLL_MS = 100;
const PAGE_TIMEOUT_MS = 120_000;

/** Evaluates an expression in the inspected page and returns its JSON-serialisable result. */
async function evalInPage(expression: string): Promise<unknown> {
  const inspected = browser.devtools.inspectedWindow;
  if (isFirefox) {
    const result: unknown = await inspected.eval(expression);
    const [value, exception] = Array.isArray(result) ? result : [result];
    if (exception) throw new Error(`Page evaluation failed: ${JSON.stringify(exception)}`);
    return value;
  }
  return new Promise((resolve, reject) =>
    inspected.eval(expression, (value: unknown, exception: unknown) =>
      exception ? reject(new Error(`Page evaluation failed: ${JSON.stringify(exception)}`)) : resolve(value),
    ),
  );
}

/**
 * Runs in the page (serialised with toString, so it must be self-contained): starts the fetch and
 * stores its outcome under `jobId` on window, where the panel collects it.
 */
function pageFetchJob(jobId: string, url: string, init: RequestInit, maxBytes: number): void {
  type Job = { done: boolean; abort?: () => void } & Record<string, unknown>;
  const scope = globalThis as unknown as { __betterDevToolsJobs?: Record<string, Job> };
  const jobs = (scope.__betterDevToolsJobs ??= {});
  const controller = new AbortController();
  jobs[jobId] = { done: false, abort: () => controller.abort() };
  fetch(url, { ...init, signal: controller.signal })
    .then(async (response) => {
      const reader = response.body?.getReader();
      let binary = '';
      let total = 0;
      let truncated = false;
      while (true) {
        if (!reader) break; // no body (e.g. 204)
        const { done, value } = await reader.read();
        if (done) break;
        const room = maxBytes - total;
        const chunk = value.length > room ? value.subarray(0, room) : value;
        for (let i = 0; i < chunk.length; i += 0x8000) binary += String.fromCharCode(...chunk.subarray(i, i + 0x8000));
        total += chunk.length;
        if (value.length > room) {
          truncated = true;
          await reader.cancel();
          break;
        }
      }
      jobs[jobId] = {
        done: true,
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        redirected: response.redirected,
        headers: [...response.headers],
        base64: btoa(binary),
        truncated,
      };
    })
    .catch((error: unknown) => {
      jobs[jobId] = { done: true, error: String(error) };
    });
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * Sends a replay from the inspected page instead of the extension: it gets the page's origin, so
 * same-origin APIs and the CORS rules that already let the page call them apply as they did for the
 * original request. inspectedWindow.eval cannot await promises, so the outcome is collected with a
 * short poll that lasts only while this one request is in flight.
 */
export async function fetchInInspectedPage(request: BuiltRequest, maxBytes: number, signal: AbortSignal): Promise<PageFetchResult> {
  const jobId = crypto.randomUUID();
  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
    credentials: request.credentials,
    redirect: 'follow',
    cache: 'no-store',
    ...(request.body === undefined ? {} : { body: request.body }),
  };
  const jobRef = `globalThis.__betterDevToolsJobs?.[${JSON.stringify(jobId)}]`;
  await evalInPage(
    `(${pageFetchJob.toString()})(${JSON.stringify(jobId)}, ${JSON.stringify(request.url)}, ${JSON.stringify(init)}, ${maxBytes})`,
  );
  const abortInPage = () => void evalInPage(`${jobRef}?.abort?.()`).catch(() => undefined);
  signal.addEventListener('abort', abortInPage, { once: true });
  try {
    for (const started = Date.now(); Date.now() - started < PAGE_TIMEOUT_MS;) {
      signal.throwIfAborted();
      await new Promise((resolve) => setTimeout(resolve, PAGE_POLL_MS));
      const job = await evalInPage(
        `(() => { const job = ${jobRef}; if (!job || !job.done) return null; delete globalThis.__betterDevToolsJobs[${JSON.stringify(jobId)}]; return job; })()`,
      );
      if (!isRecord(job)) continue;
      if (typeof job.error === 'string') throw new TypeError(job.error);
      return {
        status: Number(job.status),
        statusText: String(job.statusText ?? ''),
        url: String(job.url ?? request.url),
        redirected: job.redirected === true,
        headers: Array.isArray(job.headers)
          ? job.headers.filter((h): h is [string, string] => Array.isArray(h) && h.length === 2).map(([n, v]) => [String(n), String(v)])
          : [],
        base64: String(job.base64 ?? ''),
        truncated: job.truncated === true,
      };
    }
    throw new Error('The page did not answer within 2 minutes');
  } finally {
    signal.removeEventListener('abort', abortInPage);
  }
}

// ------------------------------------------------------------------------- cookies in replays

const COOKIE_RULE_ID = 4242;

/**
 * Runs `send` with a one-request declarativeNetRequest rule that sets request headers fetch()
 * cannot set (Cookie, User-Agent). The rule only matches this URL when this extension initiates it, and is removed
 * right after, so no page traffic and no stored cookie is touched.
 */
export async function withRequestHeaders<T>(url: string, headers: Record<string, string>, send: () => Promise<T>): Promise<T> {
  const denied = await requestPermissions(['declarativeNetRequestWithHostAccess'], url);
  const rules = browser.declarativeNetRequest;
  if (denied || !rules?.updateSessionRules)
    throw new Error(`Edited cookies or the custom user agent were not sent: ${denied ?? 'declarativeNetRequest is unavailable'}`);
  await rules.updateSessionRules({
    removeRuleIds: [COOKIE_RULE_ID],
    addRules: [
      {
        id: COOKIE_RULE_ID,
        priority: 1,
        action: {
          type: rules.RuleActionType.MODIFY_HEADERS,
          requestHeaders: Object.entries(headers).map(([header, value]) => ({ header, operation: rules.HeaderOperation.SET, value })),
        },
        condition: {
          urlFilter: `|${url}|`,
          initiatorDomains: [browser.runtime.id], // only this extension's own request, never page traffic
          resourceTypes: [rules.ResourceType.XMLHTTPREQUEST, rules.ResourceType.OTHER],
        },
      },
    ],
  });
  try {
    return await send();
  } finally {
    await rules.updateSessionRules({ removeRuleIds: [COOKIE_RULE_ID] });
  }
}

// ------------------------------------------------------------------------------ disable cache

const CACHE_RULE_ID = 4243;

/**
 * Turns "disable cache" on or off for the inspected tab: a session network rule asks every
 * request of that tab to skip the HTTP cache (Cache-Control/Pragma: no-cache), as the DevTools
 * checkbox does. Needs access to all sites, asked when it is switched on. Resolves with why it
 * failed, or null.
 */
export async function setCacheDisabled(disabled: boolean): Promise<string | null> {
  try {
    if (!disabled) {
      // without the permission the API does not exist, and then there is no rule to remove
      await browser.declarativeNetRequest?.updateSessionRules?.({ removeRuleIds: [CACHE_RULE_ID] });
      return null;
    }
    // asked first: the declarativeNetRequest API only appears once this optional permission is granted
    const api = browser.permissions;
    if (typeof api?.request !== 'function') return 'not available in this browser’s DevTools panel';
    const granted = await withTimeout(
      api.request({ permissions: ['declarativeNetRequestWithHostAccess'], origins: ['http://*/*', 'https://*/*'] }),
      PERMISSION_TIMEOUT_MS,
      null,
    );
    if (!granted) return granted === null ? 'the permission prompt did not answer' : 'permission was refused';
    const rules = browser.declarativeNetRequest;
    if (!rules?.updateSessionRules) return 'declarativeNetRequest is unavailable here';
    await rules.updateSessionRules({
      removeRuleIds: [CACHE_RULE_ID],
      addRules: [
        {
          id: CACHE_RULE_ID,
          priority: 1,
          action: {
            type: rules.RuleActionType.MODIFY_HEADERS,
            requestHeaders: [
              { header: 'cache-control', operation: rules.HeaderOperation.SET, value: 'no-cache' },
              { header: 'pragma', operation: rules.HeaderOperation.SET, value: 'no-cache' },
            ],
          },
          condition: { tabIds: [browser.devtools.inspectedWindow.tabId], resourceTypes: Object.values(rules.ResourceType) },
        },
      ],
    });
    return null;
  } catch (error) {
    return String(error);
  }
}

// --------------------------------------------------------------------------- browser cookie jar

export type StoreCookie = Browser.cookies.Cookie;

/** The browser's real cookie jar for one URL; `cookies` permission + that origin, asked on use. */
export const cookieJar = {
  async open(url: string): Promise<{ cookies: StoreCookie[] } | { unavailable: string }> {
    const denied = await requestPermissions(['cookies'], url);
    if (denied || !browser.cookies) return { unavailable: denied ?? 'not available here' };
    return { cookies: await browser.cookies.getAll({ url }) };
  },
  /** Creates or replaces a cookie; resolves with the stored cookie or rejects with the browser's reason. */
  async set(details: Browser.cookies.SetDetails): Promise<StoreCookie> {
    const stored = await browser.cookies.set(details);
    if (!stored) throw new Error(browser.runtime.lastError?.message ?? 'the browser refused the cookie');
    return stored;
  },
  async remove(url: string, name: string, storeId?: string): Promise<void> {
    await browser.cookies.remove({ url, name, ...(storeId ? { storeId } : {}) });
  },
};

/** URL that addresses a stored cookie (scheme from Secure, host from Domain, its Path). */
export const cookieUrl = (cookie: Pick<StoreCookie, 'domain' | 'path' | 'secure'>) =>
  `${cookie.secure ? 'https' : 'http'}://${cookie.domain.replace(/^\./, '')}${cookie.path}`;
